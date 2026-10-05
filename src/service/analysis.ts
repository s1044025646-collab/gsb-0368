import { decodeWaveform } from '../core/decoder.js';
import { validateParams, validateWaveform } from '../core/waveform.js';
import type { AppDatabase } from '../db/database.js';
import type { DecodeResult, FrameResult } from '../core/types.js';

export function collectErrors(result: DecodeResult): { frameIndex: number | null; code: string; detail: string }[] {
  const rows: { frameIndex: number | null; code: string; detail: string }[] = [];
  for (const n of result.noiseCandidates) {
    rows.push({
      frameIndex: null,
      code: 'NOISE_SHORT_PULSE',
      detail: `下降沿 tick=${n.fallingTick}，中心 tick=${n.centerTick} 已为高电平，重新搜索边界 tick=${n.resumeSearchTick}`,
    });
  }
  for (const f of result.frames) {
    for (const code of f.status) {
      if (code === 'OK') continue;
      rows.push({ frameIndex: f.frameIndex, code, detail: describeFrameError(f, code) });
    }
  }
  return rows;
}

function describeFrameError(f: FrameResult, code: string): string {
  if ('endTick' in f) {
    switch (code) {
      case 'PARITY_ERROR':
        return `帧#${f.frameIndex} 校验位实际=${f.parityActual}，预期=${f.parityExpected}`;
      case 'FRAME_ERROR_STOP_LOW':
        return `帧#${f.frameIndex} 停止位电平为 0`;
      default:
        return `帧#${f.frameIndex} ${code}`;
    }
  }
  return `帧#${f.frameIndex} 记录在必要采样前结束（开始 tick=${f.startTick}，预计结束 tick=${f.expectedEndTick}）`;
}

export function runAndStoreAnalysis(
  db: AppDatabase,
  waveformId: number,
  rawParams: unknown,
): { analysisId: number; result: DecodeResult } {
  const stored = db.getWaveform(waveformId);
  if (!stored) throw new Error(`波形 #${waveformId} 不存在`);
  const waveform = JSON.parse(stored.payload);
  validateWaveform(waveform);
  const params = validateParams(rawParams);

  const paramsVersion = db.getOrCreateParamsVersion(waveformId, params.bitTicks, params.parity);
  const existing = db.findAnalysis(waveformId, params.bitTicks, params.parity);
  if (existing) {
    return { analysisId: existing.id, result: JSON.parse(existing.result) as DecodeResult };
  }

  const result = decodeWaveform(waveform, params);
  const analysisId = db.saveAnalysis(
    waveformId,
    paramsVersion,
    params.bitTicks,
    params.parity,
    result,
    collectErrors(result),
  );
  return { analysisId, result };
}
