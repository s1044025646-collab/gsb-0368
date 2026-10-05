import { LIMITS, ValidationError, type WaveformInput } from './types.js';

export interface ValidatedWaveform {
  initialLevel: 0 | 1;
  transitions: { tick: number; level: 0 | 1 }[];
  endTick: number;
}

function isInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isSafeInteger(v);
}

export function validateWaveform(input: unknown): ValidatedWaveform {
  if (typeof input !== 'object' || input === null) {
    throw new ValidationError('WAVEFORM_INVALID', '波形输入必须是对象');
  }
  const wf = input as Record<string, unknown>;

  if (wf.initialLevel !== 0 && wf.initialLevel !== 1) {
    throw new ValidationError(
      'INITIAL_LEVEL_INVALID',
      'initialLevel 必须是二值电平 0 或 1；本教学模型限定初始空闲高电平 1',
    );
  }
  if (wf.initialLevel !== 1) {
    throw new ValidationError(
      'INITIAL_LEVEL_NOT_IDLE_HIGH',
      '初始电平必须为空闲高电平 1',
    );
  }

  if (!Array.isArray(wf.transitions)) {
    throw new ValidationError('TRANSITIONS_INVALID', 'transitions 必须是数组');
  }
  if (wf.transitions.length > LIMITS.MAX_TRANSITIONS) {
    throw new ValidationError(
      'TRANSITIONS_TOO_MANY',
      `变化记录条数超过上限 ${LIMITS.MAX_TRANSITIONS}`,
    );
  }

  const transitions: { tick: number; level: 0 | 1 }[] = [];
  let lastTick = -1;
  let currentLevel: 0 | 1 = 1;
  for (let i = 0; i < wf.transitions.length; i++) {
    const tr = wf.transitions[i] as Record<string, unknown> | null;
    if (!tr || typeof tr !== 'object') {
      throw new ValidationError('TRANSITION_INVALID', `第 ${i} 条变化记录不是对象`);
    }
    if (!isInt(tr.tick) || (tr.tick as number) < 0) {
      throw new ValidationError(
        'TICK_INVALID',
        `第 ${i} 条变化时刻必须为非负整数`,
      );
    }
    if (tr.level !== 0 && tr.level !== 1) {
      throw new ValidationError(
        'LEVEL_NON_BINARY',
        `第 ${i} 条变化后的电平必须是 0 或 1`,
      );
    }
    const tick = tr.tick as number;
    const level = tr.level as 0 | 1;
    if (tick <= lastTick) {
      throw new ValidationError(
        tick === lastTick ? 'TICK_DUPLICATE' : 'TICK_ORDER_INVALID',
        `第 ${i} 条变化时刻 ${tick} ${tick === lastTick ? '与前一条重复' : '未严格递增'}`,
      );
    }
    if (level === currentLevel) {
      throw new ValidationError(
        'TRANSITION_REDUNDANT',
        `tick=${tick} 的变化记录未翻转电平（仍为 ${level}），属于冗余记录`,
      );
    }
    transitions.push({ tick, level });
    lastTick = tick;
    currentLevel = level;
  }

  if (!isInt(wf.endTick) || (wf.endTick as number) <= 0) {
    throw new ValidationError('END_TICK_INVALID', 'endTick 必须为正整数');
  }
  const endTick = wf.endTick as number;
  if (transitions.length > 0 && lastTick >= endTick) {
    throw new ValidationError(
      'TICK_OUT_OF_RANGE',
      `变化时刻 ${lastTick} 超出记录结束时刻 ${endTick}（半开区间 [0, endTick)）`,
    );
  }
  if (endTick > LIMITS.MAX_TIME_RANGE) {
    throw new ValidationError(
      'TIME_RANGE_TOO_LARGE',
      `总时间范围超过上限 ${LIMITS.MAX_TIME_RANGE} tick`,
    );
  }

  return { initialLevel: 1, transitions, endTick };
}

export function validateParams(input: unknown): { bitTicks: number; parity: 'none' | 'even' | 'odd' } {
  if (typeof input !== 'object' || input === null) {
    throw new ValidationError('PARAMS_INVALID', '接收参数必须是对象');
  }
  const p = input as Record<string, unknown>;
  if (!isInt(p.bitTicks) || (p.bitTicks as number) <= 0) {
    throw new ValidationError('BIT_TICKS_INVALID', 'bitTicks 必须为正整数');
  }
  if ((p.bitTicks as number) % 2 !== 0) {
    throw new ValidationError('BIT_TICKS_NOT_EVEN', 'bitTicks 必须为正偶数 tick');
  }
  if (p.parity !== 'none' && p.parity !== 'even' && p.parity !== 'odd') {
    throw new ValidationError('PARITY_INVALID', "parity 必须为 'none' | 'even' | 'odd'");
  }
  return { bitTicks: p.bitTicks as number, parity: p.parity };
}

export class LevelTable {
  private readonly transitions: { tick: number; level: 0 | 1 }[];
  private cursor = 0;
  private level: 0 | 1;

  constructor(wf: ValidatedWaveform, private readonly endTick: number) {
    this.transitions = wf.transitions;
    this.level = wf.initialLevel;
  }

  sampleAt(tick: number): 0 | 1 {
    while (this.cursor < this.transitions.length && this.transitions[this.cursor]!.tick <= tick) {
      this.level = this.transitions[this.cursor]!.level;
      this.cursor++;
    }
    return this.level;
  }

  inRange(tick: number): boolean {
    return tick < this.endTick;
  }
}
