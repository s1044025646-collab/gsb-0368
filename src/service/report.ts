import type { DecodeResult, DecodedFrame, TruncatedFrame } from '../core/types.js';

export function exportReport(result: DecodeResult, format: 'json' | 'text' | 'csv'): string {
  if (format === 'json') return JSON.stringify(result, null, 2);
  if (format === 'csv') return toCsv(result);
  return toText(result);
}

function toText(result: DecodeResult): string {
  const lines: string[] = [];
  lines.push(`UART 解码报告 | B=${result.params.bitTicks} parity=${result.params.parity} | 记录结束 tick=${result.recordEndTick}`);
  for (const n of result.noiseCandidates) {
    lines.push(
      `[噪声] 下降沿 t=${n.fallingTick} 中心 t=${n.centerTick} 电平=1；从 t=${n.resumeSearchTick} 起重新寻找下降沿`,
    );
  }
  for (const f of result.frames) {
    if ('endTick' in f) {
      lines.push(
        `帧#${f.frameIndex} [${f.startTick},${f.endTick}) ${f.hexByte} LSB先传=${f.bitOrderLsbFirst} 状态=${f.status.join('|')} ` +
          `停止位=${f.stopLevel}` +
          (result.params.parity === 'none'
            ? ''
            : ` 校验预期=${f.parityExpected} 实际=${f.parityActual}`),
      );
      for (const s of f.samples) {
        lines.push(`  ${s.bit.padEnd(6)} t=${s.tick} 电平=${s.level}`);
      }
    } else {
      const tr = f as TruncatedFrame;
      lines.push(
        `帧#${tr.frameIndex} 截断 开始 t=${tr.startTick} 预计结束 t=${tr.expectedEndTick} ` +
          `已收字节=${tr.receivedByte === null ? '-' : '0x' + tr.receivedByte.toString(16).toUpperCase().padStart(2, '0')} ` +
          `已收到位: ${tr.receivedBits.map((b) => `${b.bit}=${b.level}@${b.tick}`).join(', ') || '无'}`,
      );
    }
  }
  return lines.join('\n');
}

function toCsv(result: DecodeResult): string {
  const rows: string[] = ['frame,startTick,endTick,bit,index,sampleTick,level,byte,hex,status'];
  for (const f of result.frames) {
    if ('endTick' in f) {
      const d = f as DecodedFrame;
      for (const s of d.samples) {
        rows.push(
          [d.frameIndex, d.startTick, d.endTick, s.bit, s.index, s.tick, s.level, d.byte, d.hexByte, d.status.join('|')].join(','),
        );
      }
    } else {
      for (const b of f.receivedBits) {
        rows.push(
          [f.frameIndex, f.startTick, f.expectedEndTick, b.bit, b.index, b.tick, b.level, '', '', f.status.join('|')].join(','),
        );
      }
    }
  }
  return rows.join('\n');
}
