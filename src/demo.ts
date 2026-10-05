import { decode } from "./decoder";
import { generateWaveform } from "./generator";
import { renderReport } from "./report";
import { Transition, WaveformInput } from "./types";

/**
 * 演示：B=10 连续发送 0x00、0x41、0xFF（核对 LSB 先传），
 * 然后加入偶校验、坏停止位、短脉冲噪声与末帧截断。
 */
function main(): void {
  const B = 10;

  // 第一部分：无校验，三个理想帧
  const ideal = generateWaveform({ bytes: [0x00, 0x41, 0xff], params: { bitPeriod: B, parity: "none" } });

  // 第二部分：手工拼接异常波形（偶校验帧、坏停止位、短脉冲、截断帧）
  const t: Transition[] = [...ideal.transitions];
  let cursor = ideal.endTick;
  let level = 1 as 0 | 1;
  const push = (tick: number, next: 0 | 1) => {
    if (next !== level) {
      t.push({ tick, level: next });
      level = next;
    }
    cursor = tick;
  };
  const frame = (byte: number, opts: { parity?: 0 | 1; badStop?: boolean; truncateAfterBits?: number }) => {
    push(cursor, 0);
    cursor += B;
    let ones = 0;
    const totalBits = 1 + 8 + (opts.parity !== undefined ? 1 : 0) + 1;
    const limit = opts.truncateAfterBits ?? totalBits;
    let emitted = 1;
    for (let i = 0; i < 8 && emitted < limit; i++, emitted++) {
      const bit = (byte >> i) & 1;
      ones += bit;
      push(cursor, bit as 0 | 1);
      cursor += B;
    }
    if (opts.parity !== undefined && emitted < limit) {
      push(cursor, opts.parity);
      cursor += B;
      emitted++;
    }
    if (emitted < limit) {
      push(cursor, opts.badStop ? 0 : 1);
      cursor += B;
      emitted++;
    }
    if (opts.badStop) {
      push(cursor, 1); // 恢复空闲
      cursor += B;
    }
  };

  // 偶校验帧 0x41（1 的个数为 2，偶校验位应为 0，故意给 1 造成校验错误）
  frame(0x41, { parity: 1 });
  cursor += 2 * B;
  // 坏停止位帧 0x55
  frame(0x55, { badStop: true });
  cursor += 2 * B;
  // 短脉冲噪声：低 3 tick 后回高（中心 t+5 已为高）
  push(cursor, 0);
  push(cursor + 3, 1);
  cursor += 4 * B;
  // 末帧截断：0x0F 只发起始位 + 5 个数据位
  frame(0x0f, { truncateAfterBits: 6 });

  const mixed: WaveformInput = { initialLevel: 1, transitions: t, endTick: cursor + B };

  const result = decode(mixed, { bitPeriod: B, parity: "none" });
  // 偶校验帧需要用 even 参数解码才有校验语义；这里分别解码演示
  const resultEven = decode(mixed, { bitPeriod: B, parity: "even" });

  console.log("=== 无校验解码 ===");
  console.log(renderReport(result));
  console.log("=== 偶校验解码（演示校验错误） ===");
  console.log(renderReport(resultEven));
}

main();
