export type Level = 0 | 1;
export type ParityMode = "none" | "even" | "odd";

export interface Transition {
  tick: number;
  level: Level;
}

export interface WaveformInput {
  initialLevel: Level;
  transitions: Transition[];
  endTick: number;
}

export interface RxParams {
  bitPeriod: number; // 正偶数 tick
  parity: ParityMode;
}

export interface SamplePoint {
  kind: "start" | "data" | "parity" | "stop";
  index: number; // data 位时为 0..7，其余为 0
  tick: number;
  level: Level | null; // null 表示记录已结束，无法采样
}

export type FrameStatus = "ok" | "parity_error" | "framing_error" | "truncated";

export interface DecodedFrame {
  frameIndex: number;
  startTick: number;
  endTick: number; // 半开区间 [startTick, endTick)
  dataBits: (Level | null)[]; // 长度 8，LSB 在前；截断时未收到的位为 null
  byte: number | null; // 由实际采到的数据位组成；任一位缺失则为 null
  byteHex: string | null;
  samples: SamplePoint[];
  parityExpected: Level | null;
  parityActual: Level | null;
  stopLevel: Level | null;
  status: FrameStatus;
  errors: string[]; // 错误码列表，可同时存在多个
}

export interface NoiseCandidate {
  tick: number; // 下降沿候选起点
  centerTick: number; // 起始位中心采样时刻
  centerLevel: Level | null;
  resumeSearchFrom: number; // 重新寻找下降沿的时间边界（半开，>= 该值）
  reason: "short_pulse" | "truncated_start";
}

export interface DecodeResult {
  params: RxParams;
  frames: DecodedFrame[];
  noise: NoiseCandidate[];
}

export const LIMITS = {
  maxTransitions: 100_000,
  maxTickSpan: 1_000_000_000,
};

export class InputError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = "InputError";
  }
}
