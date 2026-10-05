export type ParityMode = 'none' | 'even' | 'odd';

export interface WaveformInput {
  name?: string;
  initialLevel: 0 | 1;
  transitions: { tick: number; level: 0 | 1 }[];
  endTick: number;
}

export interface ReceiverParams {
  bitTicks: number;
  parity: ParityMode;
}

export interface SamplePoint {
  bit: string;
  index: number;
  tick: number;
  level: 0 | 1;
  inRange: boolean;
}

export interface TruncatedFrame {
  frameIndex: number;
  startTick: number;
  expectedEndTick: number;
  receivedBits: SamplePoint[];
  receivedByte: number | null;
  status: string[];
}

export interface NoiseCandidate {
  fallingTick: number;
  centerTick: number;
  centerLevel: 0 | 1;
  resumeSearchTick: number;
}

export interface DecodedFrame {
  frameIndex: number;
  startTick: number;
  endTick: number;
  bitOrderLsbFirst: string;
  hexByte: string;
  byte: number;
  samples: SamplePoint[];
  parityExpected: 0 | 1 | null;
  parityActual: 0 | 1 | null;
  stopLevel: 0 | 1;
  status: string[];
  truncated: false;
}

export type FrameResult = DecodedFrame | TruncatedFrame;

export interface DecodeResult {
  params: ReceiverParams;
  recordEndTick: number;
  frames: FrameResult[];
  noiseCandidates: NoiseCandidate[];
}

export class ValidationError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'ValidationError';
    this.code = code;
  }
}

export const LIMITS = {
  MAX_TRANSITIONS: 100_000,
  MAX_TIME_RANGE: 1_000_000_000,
} as const;
