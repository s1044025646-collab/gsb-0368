import { createServer, type IncomingMessage, type Server } from 'node:http';
import { generateWaveform } from '../core/generator.js';
import { decodeWaveform } from '../core/decoder.js';
import { ValidationError } from '../core/types.js';
import { AppDatabase } from '../db/database.js';
import { collectErrors, runAndStoreAnalysis } from '../service/analysis.js';
import { exportReport } from '../service/report.js';

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new ValidationError('JSON_INVALID', '请求体不是合法 JSON');
  }
}

export function createApiServer(db: AppDatabase): Server {
  return createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const path = url.pathname;
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(body));
    };
    try {
      if (req.method === 'GET' && path === '/health') {
        send(200, { ok: true });
        return;
      }

      if (req.method === 'POST' && path === '/waveforms') {
        const body = (await readJson(req)) as { name?: string; waveform?: unknown };
        const saved = db.saveWaveform(body.name ?? '未命名波形', body.waveform ?? {});
        send(201, { id: saved.id, name: saved.name });
        return;
      }

      if (req.method === 'GET' && path === '/waveforms') {
        send(200, db.listWaveforms());
        return;
      }

      const wfMatch = path.match(/^\/waveforms\/(\d+)$/);
      if (req.method === 'GET' && wfMatch) {
        const wf = db.getWaveform(Number(wfMatch[1]));
        if (!wf) return send(404, { error: { code: 'NOT_FOUND', message: '波形不存在' } });
        send(200, { id: wf.id, name: wf.name, waveform: JSON.parse(wf.payload) });
        return;
      }

      if (req.method === 'POST' && path === '/waveforms/generate') {
        const body = (await readJson(req)) as Parameters<typeof generateWaveform>[0];
        const waveform = generateWaveform(body);
        const saved = db.saveWaveform(body.name ?? '演示波形', waveform);
        send(201, { id: saved.id, name: saved.name, waveform });
        return;
      }

      const decodeMatch = path.match(/^\/waveforms\/(\d+)\/decode$/);
      if (req.method === 'POST' && decodeMatch) {
        const body = (await readJson(req)) as { bitTicks?: number; parity?: string };
        const { analysisId, result } = runAndStoreAnalysis(db, Number(decodeMatch[1]), body);
        send(200, { analysisId, result, errors: db.listErrors(analysisId) });
        return;
      }

      const explainMatch = path.match(/^\/analyses\/(\d+)$/);
      if (req.method === 'GET' && explainMatch) {
        const id = Number(explainMatch[1]);
        const analysis = db.getAnalysis(id);
        if (!analysis) return send(404, { error: { code: 'NOT_FOUND', message: '分析不存在' } });
        send(200, {
          id: analysis.id,
          waveformId: analysis.waveformId,
          paramsVersion: analysis.paramsVersion,
          bitTicks: analysis.bitTicks,
          parity: analysis.parity,
          result: JSON.parse(analysis.result),
          errors: db.listErrors(id),
        });
        return;
      }

      if (req.method === 'GET' && path === '/decode-preview') {
        const waveform = JSON.parse(url.searchParams.get('waveform') ?? '{}');
        const bitTicks = Number(url.searchParams.get('bitTicks'));
        const parity = url.searchParams.get('parity') ?? 'none';
        const result = decodeWaveform(waveform, { bitTicks, parity });
        send(200, { result, errors: collectErrors(result) });
        return;
      }

      const reportMatch = path.match(/^\/waveforms\/(\d+)\/report$/);
      if (req.method === 'GET' && reportMatch) {
        const bitTicks = Number(url.searchParams.get('bitTicks'));
        const parity = url.searchParams.get('parity') ?? 'none';
        const format = (url.searchParams.get('format') ?? 'text') as 'json' | 'text' | 'csv';
        if (!['json', 'text', 'csv'].includes(format)) {
          throw new ValidationError('FORMAT_INVALID', "format 必须为 json | text | csv");
        }
        const { result } = runAndStoreAnalysis(db, Number(reportMatch[1]), { bitTicks, parity });
        const body = exportReport(result, format);
        const mime = format === 'json' ? 'application/json' : format === 'csv' ? 'text/csv' : 'text/plain';
        res.writeHead(200, { 'content-type': `${mime}; charset=utf-8` });
        res.end(body);
        return;
      }

      send(404, { error: { code: 'NOT_FOUND', message: '未知路由' } });
    } catch (err) {
      if (err instanceof ValidationError) {
        send(400, { error: { code: err.code, message: err.message } });
      } else {
        send(500, { error: { code: 'INTERNAL_ERROR', message: (err as Error).message } });
      }
    }
  });
}

export function pickFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.listen(0, '127.0.0.1', () => {
      const addr = probe.address();
      probe.close(() => {
        if (addr && typeof addr === 'object') resolve(addr.port);
        else reject(new Error('无法获取空闲端口'));
      });
    });
    probe.on('error', reject);
  });
}
