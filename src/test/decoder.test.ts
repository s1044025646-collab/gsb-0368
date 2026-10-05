import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeWaveform } from '../core/decoder.js';
import { generateWaveform } from '../core/generator.js';
import type { DecodedFrame, TruncatedFrame, WaveformInput } from '../core/types.js';

const NONE = { bitTicks: 10, parity: 'none' as const };

function shift(wf: WaveformInput, offset: number): WaveformInput {
  return {
    ...wf,
    transitions: wf.transitions.map((t) => ({ tick: t.tick + offset, level: t.level })),
    endTick: wf.endTick + offset,
  };
}

test('手写电平表: 0x00 起始位/数据位/停止位采样位置与值', () => {
  const wf: WaveformInput = {
    initialLevel: 1,
    transitions: [
      { tick: 0, level: 0 },
      { tick: 90, level: 1 },
    ],
    endTick: 100,
  };
  const r = decodeWaveform(wf, NONE);
  assert.equal(r.frames.length, 1);
  const f = r.frames[0] as DecodedFrame;
  assert.equal(f.byte, 0x00);
  assert.equal(f.hexByte, '0x00');
  assert.equal(f.bitOrderLsbFirst, '00000000');
  assert.deepEqual(
    f.samples.map((s) => [s.bit, s.tick, s.level]),
    [
      ['start', 5, 0],
      ['D0', 15, 0],
      ['D1', 25, 0],
      ['D2', 35, 0],
      ['D3', 45, 0],
      ['D4', 55, 0],
      ['D5', 65, 0],
      ['D6', 75, 0],
      ['D7', 85, 0],
      ['stop', 95, 1],
    ],
  );
  assert.equal(f.stopLevel, 1);
  assert.deepEqual(f.status, ['OK']);
  assert.equal(f.startTick, 0);
  assert.equal(f.endTick, 100);
});

test('手写电平表: 0x41 LSB 先传且采样点恰与跳变重合时取变化后电平', () => {
  const wf: WaveformInput = {
    initialLevel: 1,
    transitions: [
      { tick: 0, level: 0 },
      { tick: 10, level: 1 },
      { tick: 20, level: 0 },
      { tick: 70, level: 1 },
      { tick: 80, level: 0 },
      { tick: 90, level: 1 },
    ],
    endTick: 100,
  };
  const r = decodeWaveform(wf, NONE);
  const f = r.frames[0] as DecodedFrame;
  assert.equal(f.byte, 0x41);
  assert.equal(f.bitOrderLsbFirst, '10000010');
  assert.equal(f.samples.find((s) => s.bit === 'D0')!.level, 1);
  assert.equal(f.samples.find((s) => s.bit === 'D6')!.level, 1);
});

test('短起始脉冲中心已高: 记为噪声候选并公开重新搜索边界', () => {
  const wf: WaveformInput = {
    initialLevel: 1,
    transitions: [
      { tick: 50, level: 0 },
      { tick: 52, level: 1 },
      { tick: 100, level: 0 },
      { tick: 200, level: 1 },
    ],
    endTick: 210,
  };
  const r = decodeWaveform(wf, NONE);
  assert.equal(r.noiseCandidates.length, 1);
  assert.deepEqual(
    {
      fallingTick: r.noiseCandidates[0]!.fallingTick,
      centerTick: r.noiseCandidates[0]!.centerTick,
      centerLevel: r.noiseCandidates[0]!.centerLevel,
      resumeSearchTick: r.noiseCandidates[0]!.resumeSearchTick,
    },
    { fallingTick: 50, centerTick: 55, centerLevel: 1, resumeSearchTick: 51 },
  );
  assert.equal(r.frames.length, 1);
  assert.equal((r.frames[0] as DecodedFrame).byte, 0x00);
  assert.equal((r.frames[0] as DecodedFrame).startTick, 100);
});

test('数据内部多次下降沿不会打断当前帧 (0x55)', () => {
  const wf = generateWaveform({ bytes: [0x55], bitTicks: 10 });
  const r = decodeWaveform(wf, NONE);
  assert.equal(r.frames.length, 1);
  const f = r.frames[0] as DecodedFrame;
  assert.equal(f.byte, 0x55);
  assert.equal(f.bitOrderLsbFirst, '10101010');
  assert.equal(r.noiseCandidates.length, 0);
});

test('背靠背帧: 下一帧最早从整段结束 tick 开始', () => {
  const wf = generateWaveform({ bytes: [0x00, 0x41, 0xff], bitTicks: 10, gapTicks: 0 });
  const r = decodeWaveform(wf, NONE);
  assert.equal(r.frames.length, 3);
  assert.deepEqual(r.frames.map((f) => (f as DecodedFrame).byte), [0x00, 0x41, 0xff]);
  assert.deepEqual(r.frames.map((f) => f.startTick), [0, 100, 200]);
  const ff = r.frames[2] as DecodedFrame;
  assert.equal(ff.bitOrderLsbFirst, '11111111');
  assert.equal(ff.endTick, 300);
});

test('额外空闲不影响帧内容', () => {
  const wf = generateWaveform({ bytes: [0x00, 0x41], bitTicks: 10, gapTicks: 37 });
  const r = decodeWaveform(wf, NONE);
  assert.deepEqual(r.frames.map((f) => (f as DecodedFrame).byte), [0x00, 0x41]);
  assert.equal(r.frames[1]!.startTick, 137);
});

test('整体时间平移只平移位置, 字节与错误不变', () => {
  const wf = generateWaveform({ bytes: [0x00, 0x41], bitTicks: 10, gapTicks: 20 });
  const r1 = decodeWaveform(wf, NONE);
  const r2 = decodeWaveform(shift(wf, 12345), NONE);
  const norm = (r: typeof r1) =>
    JSON.stringify(r).replace(/"startTick":\d+|"endTick":\d+|"tick":\d+|"recordEndTick":\d+/g, '"x":0');
  assert.equal(norm(r2), norm(r1));
  assert.equal(r2.frames[0]!.startTick, r1.frames[0]!.startTick + 12345);
});

test('偶校验: 正确帧 OK, 错误校验位标记 PARITY_ERROR 且保留字节', () => {
  const good = decodeWaveform(
    generateWaveform({ bytes: [0x41], bitTicks: 10, parity: 'even' }),
    { bitTicks: 10, parity: 'even' },
  );
  const gf = good.frames[0] as DecodedFrame;
  assert.deepEqual(gf.status, ['OK']);
  assert.equal(gf.parityExpected, 0);
  assert.equal(gf.parityActual, 0);

  const badWf: WaveformInput = {
    initialLevel: 1,
    transitions: [
      { tick: 0, level: 0 },
      { tick: 10, level: 1 },
      { tick: 20, level: 0 },
      { tick: 70, level: 1 },
      { tick: 80, level: 0 },
      { tick: 90, level: 1 },
    ],
    endTick: 110,
  };
  const bad = decodeWaveform(badWf, { bitTicks: 10, parity: 'even' });
  const bf = bad.frames[0] as DecodedFrame;
  assert.equal(bf.byte, 0x41);
  assert.equal(bf.parityExpected, 0);
  assert.equal(bf.parityActual, 1);
  assert.deepEqual(bf.status, ['PARITY_ERROR']);
});

test('奇校验: 0x41 校验位应为 1', () => {
  const r = decodeWaveform(
    generateWaveform({ bytes: [0x41], bitTicks: 10, parity: 'odd' }),
    { bitTicks: 10, parity: 'odd' },
  );
  const f = r.frames[0] as DecodedFrame;
  assert.deepEqual(f.status, ['OK']);
  assert.equal(f.parityExpected, 1);
  assert.equal(f.parityActual, 1);
});

test('坏停止位: FRAME_ERROR_STOP_LOW 与校验错误可同时存在, 帧不删除', () => {
  const wf = generateWaveform({
    bytes: [0x41],
    bitTicks: 10,
    parity: 'even',
    badStopIndices: [0],
  });
  const r = decodeWaveform(wf, { bitTicks: 10, parity: 'even' });
  const f = r.frames[0] as DecodedFrame;
  assert.equal(f.byte, 0x41);
  assert.ok(f.status.includes('FRAME_ERROR_STOP_LOW'));
});

test('记录在停止位前结束: 标记截断并列出已收到位与字节', () => {
  const wf = generateWaveform({
    bytes: [0x00, 0x41],
    bitTicks: 10,
    gapTicks: 10,
    truncateLastAtBit: 9,
  });
  const r = decodeWaveform(wf, NONE);
  assert.equal(r.frames.length, 2);
  const t = r.frames[1] as TruncatedFrame;
  assert.ok(t.status.includes('TRUNCATED'));
  assert.equal(t.receivedByte, 0x41);
  assert.equal(t.receivedBits.length, 9);
  assert.equal(t.receivedBits[t.receivedBits.length - 1]!.bit, 'D7');
});

test('起始位中心都未到就结束: 截断候选无已收位', () => {
  const wf: WaveformInput = {
    initialLevel: 1,
    transitions: [{ tick: 10, level: 0 }],
    endTick: 12,
  };
  const r = decodeWaveform(wf, NONE);
  assert.equal(r.frames.length, 1);
  const t = r.frames[0] as TruncatedFrame;
  assert.deepEqual(t.status, ['TRUNCATED_START_UNVERIFIED']);
  assert.equal(t.receivedByte, null);
});
