import { DecodeResult } from "./types";

/** 导出人类可读的采样解释报告（Markdown）。 */
export function renderReport(
  result: DecodeResult,
  meta?: { waveformId?: number; paramsId?: number },
): string {
  const lines: string[] = [];
  lines.push("# UART 解码报告");
  lines.push("");
  if (meta?.waveformId !== undefined) lines.push(`- 波形 ID: ${meta.waveformId}`);
  if (meta?.paramsId !== undefined) lines.push(`- 参数版本 ID: ${meta.paramsId}`);
  lines.push(`- 位周期 B = ${result.params.bitPeriod} tick，校验模式: ${result.params.parity}`);
  lines.push(`- 帧数: ${result.frames.length}，噪声候选: ${result.noise.length}`);
  lines.push("");

  for (const f of result.frames) {
    lines.push(`## 帧 #${f.frameIndex} [${f.startTick}, ${f.endTick}) 状态: ${f.status}`);
    lines.push(
      `- 字节: ${f.byteHex ?? "(不完整)"}，数据位(LSB->MSB): ${f.dataBits.map((b) => (b === null ? "?" : b)).join("")}`,
    );
    if (f.errors.length) lines.push(`- 错误: ${f.errors.join(", ")}`);
    if (f.parityExpected !== null || f.parityActual !== null) {
      lines.push(`- 校验: 期望 ${f.parityExpected ?? "?"}, 实际 ${f.parityActual ?? "?"}`);
    }
    lines.push(`- 停止位: ${f.stopLevel ?? "?"}`);
    lines.push("");
    lines.push("| 位 | 序号 | 采样 tick | 电平 |");
    lines.push("|---|---|---|---|");
    for (const s of f.samples) {
      lines.push(`| ${s.kind} | ${s.index} | ${s.tick} | ${s.level ?? "记录外"} |`);
    }
    lines.push("");
  }

  if (result.noise.length) {
    lines.push("## 噪声候选（短脉冲 / 截断起始）");
    lines.push("");
    lines.push("| 下降沿 tick | 中心采样 tick | 中心电平 | 重新寻找边界 | 原因 |");
    lines.push("|---|---|---|---|---|");
    for (const n of result.noise) {
      lines.push(
        `| ${n.tick} | ${n.centerTick} | ${n.centerLevel ?? "记录外"} | >= ${n.resumeSearchFrom} | ${n.reason} |`,
      );
    }
    lines.push("");
  }
  return lines.join("\n");
}
