import assert from "node:assert/strict";
import { test } from "node:test";
import { decode } from "../src/decoder";
import { generateWaveform } from "../src/generator";
import { validateParams } from "../src/params";
import { Store } from "../src/store";
import { InputError, WaveformInput } from "../src/types";
import { levelAt, validateWaveform } from "../src/waveform";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const B = 10;

// 手写电平表：t=100 起一帧 0x41（LSB: 1,0,0,0,0,0,1,0），B=10
const handwritten: WaveformInput = {
  initialLevel: 1,
  transitions: [
    { tick: 100, level: 0 }, // 起始位
    { tick: 110, level: 1 }, // d0 = 1
    { tick: 120, level: 0 }, // d1..d5 = 0
    { tick: 170, level: 1 }, // d6 = 1
    { tick: 180, level: 0 }, // d7 = 0
    { tick: 190, level: 1 }, // 停止位
  ],
  endTick: 220,
};

test("手写电平表：采样时刻与值逐一核对", () => {
  const r = decode(handwritten, { bitPeriod: B, parity: "none" });
  assert.equal(r.frames.length, 1);
  const f = r.frames[0];
  assert.equal(f.startTick, 100);
  assert.equal(f.endTick, 200); // [100, 200) 半开
  assert.equal(f.byte, 0x41);
  assert.equal(f.byteHex, "0x41");
  assert.equal(f.status, "ok");
  const ticks = f.samples.map((s) => s.tick);
  assert.deepEqual(ticks, [105, 115, 125, 135, 145, 155, 165, 175, 185, 195]);
  const levels = f.samples.map((s) => s.level);
  assert.deepEqual(levels, [0, 1, 0, 0, 0, 0, 0, 1, 0, 1]);
  assert.deepEqual(f.dataBits, [1, 0, 0, 0, 0, 0, 1, 0]); // LSB 先传
});

test("采样点与跳变重合时采用变化后的电平", () => {
  // 起始位 t=0，d0 采样点恰为 15，变化恰在 15 拉高
  const w: WaveformInput = {
    initialLevel: 1,
    transitions: [
      { tick: 0, level: 0 },
      { tick: 15, level: 1 }, // d0 采样时刻 = 15，取变化后的 1
      { tick: 25, level: 0 },
      { tick: 90, level: 1 },
    ],
    endTick: 120,
  };
  assert.equal(levelAt(w, 15), 1);
  const r = decode(w, { bitPeriod: B, parity: "none" });
  assert.equal(r.frames[0].dataBits[0], 1);
  assert.equal(r.frames[0].byte, 0x01);
});

test("背靠背帧与额外空闲", () => {
  const w = generateWaveform({ bytes: [0x00, 0x41, 0xff], params: { bitPeriod: B, parity: "none" }, startTick: 0 });
  const r = decode(w, { bitPeriod: B, parity: "none" });
  assert.deepEqual(r.frames.map((f) => f.byte), [0x00, 0x41, 0xff]);
  assert.equal(r.frames[0].endTick, r.frames[1].startTick); // 背靠背
  const w2 = generateWaveform({ bytes: [0x41, 0x42], params: { bitPeriod: B, parity: "none" }, startTick: 0, idleGapBits: 3 });
  const r2 = decode(w2, { bitPeriod: B, parity: "none" });
  assert.deepEqual(r2.frames.map((f) => f.byte), [0x41, 0x42]);
  assert.equal(r2.frames[1].startTick, r2.frames[0].endTick + 30);
});

test("数据内部多次下降沿不打断当前帧", () => {
  // 0xA5 = 1010_0101，LSB: 1,0,1,0,0,1,0,1 内部有 3 次下降沿
  const w = generateWaveform({ bytes: [0xa5], params: { bitPeriod: B, parity: "none" }, startTick: 0 });
  const r = decode(w, { bitPeriod: B, parity: "none" });
  assert.equal(r.frames.length, 1);
  assert.equal(r.frames[0].byte, 0xa5);
});

test("偶校验与奇校验", () => {
  const w = generateWaveform({ bytes: [0x41], params: { bitPeriod: B, parity: "even" }, startTick: 0 });
  const ok = decode(w, { bitPeriod: B, parity: "even" });
  assert.equal(ok.frames[0].status, "ok");
  assert.equal(ok.frames[0].parityExpected, 0); // 0x41 有 2 个 1
  const bad = decode(w, { bitPeriod: B, parity: "odd" });
  assert.equal(bad.frames[0].status, "parity_error");
  assert.deepEqual(bad.frames[0].errors, ["PARITY_ERROR"]);
  assert.equal(bad.frames[0].byte, 0x41); // 坏帧字节保留
});

test("坏停止位标记且保留字节", () => {
  const w: WaveformInput = {
    initialLevel: 1,
    transitions: [
      { tick: 0, level: 0 },
      { tick: 110, level: 1 }, // 停止位期间（采样点 95）保持为低
    ],
    endTick: 130,
  };
  const r = decode(w, { bitPeriod: B, parity: "none" });
  assert.equal(r.frames[0].status, "framing_error");
  assert.deepEqual(r.frames[0].errors, ["STOP_BIT_ERROR"]);
  assert.equal(r.frames[0].byte, 0x00);
  assert.equal(r.frames[0].stopLevel, 0);
});

test("短脉冲记为噪声候选并公开重寻边界", () => {
  const w: WaveformInput = {
    initialLevel: 1,
    transitions: [
      { tick: 10, level: 0 },
      { tick: 13, level: 1 }, // 3 tick 短脉冲，中心 15 已为高
      { tick: 50, level: 0 }, // 真正的帧 0xFF
      { tick: 60, level: 1 },
    ],
    endTick: 160,
  };
  const r = decode(w, { bitPeriod: B, parity: "none" });
  assert.equal(r.noise.length, 1);
  assert.equal(r.noise[0].tick, 10);
  assert.equal(r.noise[0].centerTick, 15);
  assert.equal(r.noise[0].centerLevel, 1);
  assert.equal(r.noise[0].resumeSearchFrom, 11);
  assert.equal(r.noise[0].reason, "short_pulse");
  assert.equal(r.frames.length, 1);
  assert.equal(r.frames[0].byte, 0xff);
});

test("末帧截断：列出已收到位，不用末尾电平补全", () => {
  const w: WaveformInput = {
    initialLevel: 1,
    transitions: [
      { tick: 0, level: 0 },
      { tick: 10, level: 1 }, // d0.. = 1
    ],
    endTick: 50, // 只能采到 d0..d3（15,25,35,45），d4 采样点 55 已在记录外
  };
  const r = decode(w, { bitPeriod: B, parity: "none" });
  const f = r.frames[0];
  assert.equal(f.status, "truncated");
  assert.ok(f.errors.includes("TRUNCATED"));
  assert.deepEqual(f.dataBits, [1, 1, 1, 1, null, null, null, null]);
  assert.equal(f.byte, null);
  assert.equal(f.samples.filter((s) => s.level === null).length > 0, true);
});

test("采样必须落在记录范围内（半开区间）", () => {
  // 停止位采样点 95 恰等于 endTick → 截断
  const w: WaveformInput = {
    initialLevel: 1,
    transitions: [{ tick: 0, level: 0 }],
    endTick: 95,
  };
  const r = decode(w, { bitPeriod: B, parity: "none" });
  assert.equal(r.frames[0].status, "truncated");
});

test("整体时间平移只平移报告位置", () => {
  const shift = 1000;
  const shifted: WaveformInput = {
    initialLevel: 1,
    transitions: handwritten.transitions.map((t) => ({ tick: t.tick + shift, level: t.level })),
    endTick: handwritten.endTick + shift,
  };
  const a = decode(handwritten, { bitPeriod: B, parity: "none" }).frames[0];
  const b = decode(shifted, { bitPeriod: B, parity: "none" }).frames[0];
  assert.equal(b.byte, a.byte);
  assert.deepEqual(b.dataBits, a.dataBits);
  assert.deepEqual(b.errors, a.errors);
  assert.equal(b.startTick, a.startTick + shift);
  assert.deepEqual(b.samples.map((s) => s.tick), a.samples.map((s) => s.tick + shift));
});

test("输入拒绝：格式无效区别于接收错误", () => {
  const bad: Array<[unknown, string]> = [
    [{ initialLevel: 0, transitions: [], endTick: 10 }, "INITIAL_LEVEL_NOT_IDLE"],
    [{ initialLevel: 1, transitions: [{ tick: 5, level: 0 }, { tick: 5, level: 1 }], endTick: 10 }, "DUPLICATE_TICK"],
    [{ initialLevel: 1, transitions: [{ tick: 8, level: 0 }, { tick: 5, level: 1 }], endTick: 10 }, "NON_INCREASING_TICKS"],
    [{ initialLevel: 1, transitions: [{ tick: 5, level: 1 }], endTick: 10 }, "REDUNDANT_TRANSITION"],
    [{ initialLevel: 1, transitions: [{ tick: 5, level: 2 }], endTick: 10 }, "INVALID_LEVEL"],
    [{ initialLevel: 1, transitions: [{ tick: 2.5, level: 0 }], endTick: 10 }, "NON_INTEGER_TICK"],
    [{ initialLevel: 1, transitions: [{ tick: 10, level: 0 }], endTick: 10 }, "TICK_OUT_OF_RANGE"],
  ];
  for (const [input, code] of bad) {
    assert.throws(() => validateWaveform(input), (e: unknown) => e instanceof InputError && e.code === code);
  }
  assert.throws(() => validateParams({ bitPeriod: 7, parity: "none" }), /正偶数/);
  assert.throws(() => validateParams({ bitPeriod: 10, parity: "mark" }), (e: unknown) => e instanceof InputError && e.code === "INVALID_PARITY");
});

test("存储：波形/参数/解码结果可重启后查询", () => {
  const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "uart-")), "t.db");
  const s1 = new Store(dbPath);
  const wid = s1.saveWaveform(handwritten, "hw");
  const pid = s1.ensureParams({ bitPeriod: B, parity: "none" });
  assert.equal(s1.ensureParams({ bitPeriod: B, parity: "none" }), pid); // 同参数复用
  const result = decode(handwritten, { bitPeriod: B, parity: "none" });
  const did = s1.saveDecode(wid, pid, result);
  s1.close();
  const s2 = new Store(dbPath); // 模拟重启
  assert.equal(s2.getWaveform(wid)!.endTick, 220);
  assert.deepEqual(s2.getParams(pid), { bitPeriod: B, parity: "none" });
  assert.equal(s2.getDecode(did)!.result.frames[0].byte, 0x41);
  s2.close();
});
