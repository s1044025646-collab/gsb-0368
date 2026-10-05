import {
  DecodedFrame,
  DecodeResult,
  Level,
  RxParams,
  SamplePoint,
  WaveformInput,
} from "./types";
import { levelAt } from "./waveform";

/**
 * 按位中心采样解码 UART 帧。
 * 候选起点为空闲阶段下降沿 t，先在 t+B/2 验证起始位为低；
 * 数据位在 t+3B/2+iB（i=0..7）采样，LSB 先传；
 * 完整帧占用 [t, t+总位数*B)，下一帧最早从该段结束开始；
 * 起始位中心已为高的短脉冲记为噪声候选，从 t+1 起重新寻找下降沿；
 * 记录在必要采样前结束则标记截断，不用末尾电平补全。
 */
export function decode(waveform: WaveformInput, params: RxParams): DecodeResult {
  const B = params.bitPeriod;
  const hasParity = params.parity !== "none";
  const totalBits = 1 + 8 + (hasParity ? 1 : 0) + 1;
  const frames: DecodedFrame[] = [];
  const noise: Array<{
    tick: number;
    centerTick: number;
    centerLevel: Level | null;
    resumeSearchFrom: number;
    reason: "short_pulse" | "truncated_start";
  }> = [];

  const falling = waveform.transitions.filter((t) => t.level === 0).map((t) => t.tick);

  let searchFrom = 0;
  let fi = 0;
  let frameIndex = 0;

  while (fi < falling.length) {
    if (falling[fi] < searchFrom) {
      fi++;
      continue;
    }
    const t = falling[fi];
    const startCenter = t + B / 2;
    const startLevel = levelAt(waveform, startCenter);

    if (startLevel === null) {
      noise.push({
        tick: t,
        centerTick: startCenter,
        centerLevel: null,
        resumeSearchFrom: t + 1,
        reason: "truncated_start",
      });
      searchFrom = t + 1;
      continue;
    }
    if (startLevel !== 0) {
      noise.push({
        tick: t,
        centerTick: startCenter,
        centerLevel: startLevel,
        resumeSearchFrom: t + 1,
        reason: "short_pulse",
      });
      searchFrom = t + 1;
      continue;
    }

    const samples: SamplePoint[] = [{ kind: "start", index: 0, tick: startCenter, level: 0 }];
    const dataBits: (Level | null)[] = [];
    let truncated = false;

    for (let i = 0; i < 8; i++) {
      const tick = t + (3 * B) / 2 + i * B;
      const level = levelAt(waveform, tick);
      samples.push({ kind: "data", index: i, tick, level });
      dataBits.push(level);
      if (level === null) truncated = true;
    }

    let parityActual: Level | null = null;
    let parityExpected: Level | null = null;
    if (hasParity) {
      const tick = t + (3 * B) / 2 + 8 * B;
      parityActual = levelAt(waveform, tick);
      samples.push({ kind: "parity", index: 0, tick, level: parityActual });
      if (parityActual === null) truncated = true;
      if (!dataBits.includes(null)) {
        const ones = (dataBits as Level[]).reduce<number>((a, b) => a + b, 0);
        parityExpected =
          params.parity === "even" ? ((ones % 2) as Level) : (((ones + 1) % 2) as Level);
      }
    }

    const stopIndex = 8 + (hasParity ? 1 : 0);
    const stopTick = t + (3 * B) / 2 + stopIndex * B;
    const stopLevel = levelAt(waveform, stopTick);
    samples.push({ kind: "stop", index: 0, tick: stopTick, level: stopLevel });
    if (stopLevel === null) truncated = true;

    const byte = dataBits.includes(null)
      ? null
      : (dataBits as Level[]).reduce<number>((acc, bit, i) => acc | (bit << i), 0);

    const errors: string[] = [];
    if (
      hasParity &&
      parityExpected !== null &&
      parityActual !== null &&
      parityActual !== parityExpected
    ) {
      errors.push("PARITY_ERROR");
    }
    if (stopLevel !== null && stopLevel !== 1) {
      errors.push("STOP_BIT_ERROR");
    }
    if (truncated) {
      errors.push("TRUNCATED");
    }

    let status: DecodedFrame["status"] = "ok";
    if (truncated) status = "truncated";
    else if (errors.includes("STOP_BIT_ERROR")) status = "framing_error";
    else if (errors.includes("PARITY_ERROR")) status = "parity_error";

    const endTick = t + totalBits * B;
    frames.push({
      frameIndex: frameIndex++,
      startTick: t,
      endTick,
      dataBits,
      byte,
      byteHex: byte === null ? null : "0x" + byte.toString(16).toUpperCase().padStart(2, "0"),
      samples,
      parityExpected,
      parityActual,
      stopLevel,
      status,
      errors,
    });

    searchFrom = endTick;
  }

  return { params, frames, noise };
}

