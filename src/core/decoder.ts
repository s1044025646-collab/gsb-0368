import { LevelTable, validateParams, validateWaveform } from './waveform.js';
import type {
  DecodeResult,
  DecodedFrame,
  FrameResult,
  NoiseCandidate,
  ParityMode,
  SamplePoint,
  TruncatedFrame,
  WaveformInput,
} from './types.js';

function bitName(position: number, parity: ParityMode): { bit: string; index: number } {
  if (position === 0) return { bit: 'start', index: 0 };
  if (position >= 1 && position <= 8) return { bit: `D${position - 1}`, index: position };
  if (parity !== 'none' && position === 9) return { bit: 'parity', index: position };
  return { bit: 'stop', index: position };
}

function frameBitCount(parity: ParityMode): number {
  return parity === 'none' ? 10 : 11;
}

export function decodeWaveform(
  rawWaveform: unknown,
  rawParams: unknown,
): DecodeResult {
  const wf = validateWaveform(rawWaveform);
  const params = validateParams(rawParams);
  const B = params.bitTicks;
  const half = B / 2;
  const table = new LevelTable(wf, wf.endTick);

  const frames: FrameResult[] = [];
  const noiseCandidates: NoiseCandidate[] = [];
  let searchBoundary = 0;
  let frameIndex = 0;

  const fallingEdges: number[] = [];
  for (const tr of wf.transitions) {
    if (tr.level === 0) fallingEdges.push(tr.tick);
  }

  for (const t of fallingEdges) {
    if (t < searchBoundary) continue;

    const centerTick = t + half;

    if (!table.inRange(centerTick)) {
      frames.push({
        frameIndex,
        startTick: t,
        expectedEndTick: t + frameBitCount(params.parity) * B,
        receivedBits: [],
        receivedByte: null,
        status: ['TRUNCATED_START_UNVERIFIED'],
      });
      searchBoundary = wf.endTick + 1;
      break;
    }

    if (table.sampleAt(centerTick) === 1) {
      const resumeSearchTick = t + 1;
      noiseCandidates.push({
        fallingTick: t,
        centerTick,
        centerLevel: 1,
        resumeSearchTick,
      });
      searchBoundary = resumeSearchTick;
      continue;
    }

    const totalBits = frameBitCount(params.parity);
    const expectedEndTick = t + totalBits * B;
    const samples: SamplePoint[] = [];

    for (let pos = 0; pos < totalBits; pos++) {
      const sampleTick = t + half + pos * B;
      const name = bitName(pos, params.parity);
      if (!table.inRange(sampleTick)) {
        samples.push({ bit: name.bit, index: name.index, tick: sampleTick, level: 0, inRange: false });
      } else {
        samples.push({
          bit: name.bit,
          index: name.index,
          tick: sampleTick,
          level: table.sampleAt(sampleTick),
          inRange: true,
        });
      }
    }

    const dataSamples = samples.slice(1, 9);
    const allDataPresent = dataSamples.every((s) => s.inRange);
    const stopSample = samples[samples.length - 1]!;
    const paritySample = params.parity === 'none' ? null : samples[9]!;

    if (!stopSample.inRange || !allDataPresent || (paritySample && !paritySample.inRange)) {
      let receivedByte: number | null = null;
      if (allDataPresent) {
        let byte = 0;
        for (let i = 0; i < 8; i++) {
          if (dataSamples[i]!.level === 1) byte |= 1 << i;
        }
        receivedByte = byte;
      }
      const truncated: TruncatedFrame = {
        frameIndex,
        startTick: t,
        expectedEndTick,
        receivedBits: samples.filter((s) => s.inRange),
        receivedByte,
        status: ['TRUNCATED'],
      };
      frames.push(truncated);
      searchBoundary = wf.endTick + 1;
      break;
    }

    let byte = 0;
    for (let i = 0; i < 8; i++) {
      if (dataSamples[i]!.level === 1) byte |= 1 << i;
    }
    const ones = countOnes(byte);
    const status: string[] = [];
    let parityExpected: 0 | 1 | null = null;
    let parityActual: 0 | 1 | null = null;
    if (params.parity === 'even') {
      parityExpected = (ones % 2) as 0 | 1;
      parityActual = paritySample!.level;
      if (parityExpected !== parityActual) status.push('PARITY_ERROR');
    } else if (params.parity === 'odd') {
      parityExpected = ((ones % 2) ^ 1) as 0 | 1;
      parityActual = paritySample!.level;
      if (parityExpected !== parityActual) status.push('PARITY_ERROR');
    }
    if (stopSample.level !== 1) status.push('FRAME_ERROR_STOP_LOW');
    if (status.length === 0) status.push('OK');

    const frame: DecodedFrame = {
      frameIndex,
      startTick: t,
      endTick: expectedEndTick,
      bitOrderLsbFirst: dataSamples.map((s) => s.level).join(''),
      hexByte: '0x' + byte.toString(16).toUpperCase().padStart(2, '0'),
      byte,
      samples,
      parityExpected,
      parityActual,
      stopLevel: stopSample.level,
      status,
      truncated: false,
    };
    frames.push(frame);
    frameIndex++;
    searchBoundary = expectedEndTick;
  }

  return { params, recordEndTick: wf.endTick, frames, noiseCandidates };
}

function countOnes(byte: number): number {
  let n = 0;
  for (let i = 0; i < 8; i++) if ((byte >> i) & 1) n++;
  return n;
}

export type { WaveformInput };
