import type { ParityMode, WaveformInput } from './types.js';

export interface GenerateOptions {
  name?: string;
  bytes: number[];
  bitTicks: number;
  parity?: ParityMode;
  gapTicks?: number;
  badStopIndices?: number[];
  glitches?: { afterFrameIndex: number; offsetTicks?: number; widthTicks?: number }[];
  truncateLastAtBit?: number;
}

export function generateWaveform(options: GenerateOptions): WaveformInput {
  const B = options.bitTicks;
  if (!Number.isSafeInteger(B) || B <= 0 || B % 2 !== 0) {
    throw new Error('bitTicks 必须为正偶数');
  }
  const parity = options.parity ?? 'none';
  const gap = options.gapTicks ?? B;
  const badStop = new Set(options.badStopIndices ?? []);
  const glitches = options.glitches ?? [];

  type Segment = { start: number; level: 0 | 1 };
  const segments: Segment[] = [];
  let cursor = 0;
  let recordEnd: number | null = null;

  options.bytes.forEach((byte, frameIdx) => {
    if (!Number.isSafeInteger(byte) || byte < 0 || byte > 255) {
      throw new Error(`第 ${frameIdx} 个字节必须在 0..255 范围内`);
    }
    const frameStart = cursor;
    const addSeg = (level: 0 | 1, length: number) => {
      segments.push({ start: cursor, level });
      cursor += length;
    };

    addSeg(0, B);
    for (let i = 0; i < 8; i++) addSeg(((byte >> i) & 1) as 0 | 1, B);
    if (parity !== 'none') {
      let ones = 0;
      for (let i = 0; i < 8; i++) ones += (byte >> i) & 1;
      const p = parity === 'even' ? (ones % 2) : ((ones % 2) ^ 1);
      addSeg(p as 0 | 1, B);
    }
    const stopLevel: 0 | 1 = badStop.has(frameIdx) ? 0 : 1;
    addSeg(stopLevel, B);

    if (options.truncateLastAtBit !== undefined && frameIdx === options.bytes.length - 1) {
      const cut = options.truncateLastAtBit;
      if (cut < 1 || cut > (parity === 'none' ? 10 : 11)) {
        throw new Error('truncateLastAtBit 超出帧位范围');
      }
      recordEnd = frameStart + cut * B + 1;
    }

    if (frameIdx < options.bytes.length - 1) cursor += gap;
  });

  const glitchEvents: { tick: number; level: 0 | 1 }[] = [];
  let lastGlitchEnd = 0;
  for (const g of glitches) {
    const frameEnd =
      frameStartOf(options.bytes, B, parity, gap, g.afterFrameIndex);
    const base = frameEnd + (g.offsetTicks ?? Math.floor(B / 4));
    const width = g.widthTicks ?? Math.max(2, B / 4);
    if (width >= B / 2) throw new Error('噪声脉冲宽度必须小于 B/2');
    glitchEvents.push({ tick: base, level: 0 });
    glitchEvents.push({ tick: base + width, level: 1 });
    lastGlitchEnd = Math.max(lastGlitchEnd, base + width);
  }

  const endTick = recordEnd ?? Math.max(cursor + B, lastGlitchEnd + B);

  const raw = segments
    .map((s) => ({ tick: s.start, level: s.level }))
    .concat(glitchEvents)
    .filter((e) => e.tick < endTick)
    .sort((a, b) => a.tick - b.tick);

  const transitions: { tick: number; level: 0 | 1 }[] = [];
  let level: 0 | 1 = 1;
  for (const e of raw) {
    if (e.level === level) continue;
    transitions.push(e);
    level = e.level;
  }

  return { name: options.name, initialLevel: 1, transitions, endTick };
}

function frameStartOf(
  bytes: number[],
  B: number,
  parity: ParityMode,
  gap: number,
  afterFrameIndex: number,
): number {
  const frameLen = (parity === 'none' ? 10 : 11) * B;
  return (afterFrameIndex + 1) * frameLen + afterFrameIndex * gap;
}
