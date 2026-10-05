import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeWaveform } from '../core/decoder.js';
import type { WaveformInput } from '../core/types.js';

function rejectCode(wf: unknown, params: unknown): string {
  try {
    decodeWaveform(wf, params);
    throw new Error('应当被拒绝');
  } catch (err) {
    return (err as { code?: string }).code ?? '';
  }
}

const base: WaveformInput = {
  initialLevel: 1,
  transitions: [{ tick: 0, level: 0 }, { tick: 90, level: 1 }],
  endTick: 100,
};
const NONE = { bitTicks: 10, parity: 'none' as const };

test('初始电平必须为空闲高电平', () => {
  assert.equal(rejectCode({ ...base, initialLevel: 0 }, NONE), 'INITIAL_LEVEL_NOT_IDLE_HIGH');
});

test('时刻必须严格递增: 乱序与重复分别报错', () => {
  assert.equal(
    rejectCode({ ...base, transitions: [{ tick: 10, level: 0 }, { tick: 5, level: 1 }] }, NONE),
    'TICK_ORDER_INVALID',
  );
  assert.equal(
    rejectCode({ ...base, transitions: [{ tick: 10, level: 0 }, { tick: 10, level: 1 }] }, NONE),
    'TICK_DUPLICATE',
  );
});

test('不翻转的冗余变化被拒绝', () => {
  assert.equal(
    rejectCode({ ...base, transitions: [{ tick: 10, level: 1 }] }, NONE),
    'TRANSITION_REDUNDANT',
  );
});

test('非二值电平被拒绝', () => {
  assert.equal(
    rejectCode(
      { initialLevel: 1, transitions: [{ tick: 10, level: 2 }], endTick: 20 },
      NONE,
    ),
    'LEVEL_NON_BINARY',
  );
});

test('变化时刻超出记录范围被拒绝', () => {
  assert.equal(
    rejectCode(
      { initialLevel: 1, transitions: [{ tick: 0, level: 0 }, { tick: 200, level: 1 }], endTick: 100 },
      NONE,
    ),
    'TICK_OUT_OF_RANGE',
  );
});

test('bitTicks 必须为正偶数', () => {
  assert.equal(rejectCode(base, { bitTicks: 0, parity: 'none' }), 'BIT_TICKS_INVALID');
  assert.equal(rejectCode(base, { bitTicks: 7, parity: 'none' }), 'BIT_TICKS_NOT_EVEN');
});

test('非法校验模式被拒绝', () => {
  assert.equal(rejectCode(base, { bitTicks: 10, parity: 'mark' }), 'PARITY_INVALID');
});

test('合法波形中的接收错误不被当作输入拒绝', () => {
  const r = decodeWaveform(base, NONE);
  assert.equal(r.frames.length, 1);
  assert.deepEqual((r.frames[0] as { status: string[] }).status, ['OK']);
});
