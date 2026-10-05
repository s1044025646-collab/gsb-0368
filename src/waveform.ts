import { InputError, Level, LIMITS, Transition, WaveformInput } from "./types";

/** 校验并规范化波形输入；不合法时抛出带错误码的 InputError（格式无效，区别于接收错误）。 */
export function validateWaveform(raw: unknown): WaveformInput {
  if (typeof raw !== "object" || raw === null) {
    throw new InputError("INVALID_FORMAT", "波形必须是对象");
  }
  const w = raw as Record<string, unknown>;

  if (w.initialLevel !== 0 && w.initialLevel !== 1) {
    throw new InputError("INVALID_LEVEL", "initialLevel 必须是 0 或 1");
  }
  if (w.initialLevel !== 1) {
    throw new InputError("INITIAL_LEVEL_NOT_IDLE", "初始电平必须为空闲高电平 1");
  }
  if (!Number.isInteger(w.endTick) || (w.endTick as number) < 0) {
    throw new InputError("INVALID_END_TICK", "endTick 必须是非负整数");
  }
  const endTick = w.endTick as number;
  if (!Array.isArray(w.transitions)) {
    throw new InputError("INVALID_FORMAT", "transitions 必须是数组");
  }
  const transitions = w.transitions as unknown[];
  if (transitions.length > LIMITS.maxTransitions) {
    throw new InputError("LIMIT_EXCEEDED", `变化条数超过上限 ${LIMITS.maxTransitions}`);
  }

  const out: Transition[] = [];
  let prevTick = -1;
  let prevLevel: Level = 1;
  for (let i = 0; i < transitions.length; i++) {
    const t = transitions[i] as Record<string, unknown>;
    if (typeof t !== "object" || t === null) {
      throw new InputError("INVALID_FORMAT", `第 ${i} 条变化必须是对象`);
    }
    if (!Number.isInteger(t.tick)) {
      throw new InputError("NON_INTEGER_TICK", `第 ${i} 条变化的 tick 不是整数`);
    }
    const tick = t.tick as number;
    if (tick < 0 || tick >= endTick) {
      throw new InputError("TICK_OUT_OF_RANGE", `第 ${i} 条变化 tick=${tick} 超出 [0, endTick) 范围`);
    }
    if (tick <= prevTick) {
      throw new InputError(
        tick === prevTick ? "DUPLICATE_TICK" : "NON_INCREASING_TICKS",
        `第 ${i} 条变化 tick=${tick} 未严格递增`,
      );
    }
    if (t.level !== 0 && t.level !== 1) {
      throw new InputError("INVALID_LEVEL", `第 ${i} 条变化 level 必须是 0 或 1`);
    }
    const level = t.level as Level;
    if (level === prevLevel) {
      throw new InputError("REDUNDANT_TRANSITION", `第 ${i} 条变化未翻转电平（仍为 ${level}）`);
    }
    out.push({ tick, level });
    prevTick = tick;
    prevLevel = level;
  }
  if (endTick > LIMITS.maxTickSpan) {
    throw new InputError("LIMIT_EXCEEDED", `总时间范围超过上限 ${LIMITS.maxTickSpan} tick`);
  }
  return { initialLevel: 1, transitions: out, endTick };
}

/**
 * 查询 t 时刻电平。采样时间恰好等于变化时刻时采用变化后的电平。
 * t 必须落在半开区间 [0, endTick) 内，否则返回 null（记录之外不可采样）。
 */
export function levelAt(w: WaveformInput, t: number): Level | null {
  if (t < 0 || t >= w.endTick) return null;
  let level: Level = w.initialLevel;
  for (const tr of w.transitions) {
    if (tr.tick > t) break;
    level = tr.level;
  }
  return level;
}
