import { Level, RxParams, Transition, WaveformInput } from "./types";

export interface GenerateOptions {
  bytes: number[];
  params: RxParams;
  startTick?: number;
  idleGapBits?: number;
  endIdleBits?: number;
}

/**
 * 理想波形生成器：仅用于演示与测试，与接收器完全分离。
 * 解码器只读取电平变化记录，绝不读取此处保存的字节答案。
 */
export function generateWaveform(opts: GenerateOptions): WaveformInput {
  const { bytes, params } = opts;
  const B = params.bitPeriod;
  const hasParity = params.parity !== "none";
  const idleGap = (opts.idleGapBits ?? 0) * B;
  const endIdle = (opts.endIdleBits ?? 2) * B;

  const transitions: Transition[] = [];
  let cursor = opts.startTick ?? B;
  let level: Level = 1;
  const push = (tick: number, next: Level) => {
    if (next !== level) {
      transitions.push({ tick, level: next });
      level = next;
    }
    cursor = tick;
  };

  for (const byte of bytes) {
    if (!Number.isInteger(byte) || byte < 0 || byte > 255) {
      throw new Error(`字节超出范围: ${byte}`);
    }
    push(cursor, 0);
    cursor += B;
    let ones = 0;
    for (let i = 0; i < 8; i++) {
      const bit = ((byte >> i) & 1) as Level;
      ones += bit;
      push(cursor, bit);
      cursor += B;
    }
    if (hasParity) {
      const parity: Level =
        params.parity === "even" ? ((ones % 2) as Level) : (((ones + 1) % 2) as Level);
      push(cursor, parity);
      cursor += B;
    }
    push(cursor, 1);
    cursor += B;
    cursor += idleGap;
  }

  return { initialLevel: 1, transitions, endTick: cursor + endIdle };
}
