import * as http from "node:http";
import { AddressInfo } from "node:net";
import { decode } from "./decoder";
import { generateWaveform } from "./generator";
import { validateParams } from "./params";
import { renderReport } from "./report";
import { Store } from "./store";
import { InputError } from "./types";
import { validateWaveform } from "./waveform";

function send(res: http.ServerResponse, status: number, body: unknown, contentType = "application/json; charset=utf-8"): void {
  const text = typeof body === "string" ? body : JSON.stringify(body, null, 2);
  res.writeHead(status, { "Content-Type": contentType });
  res.end(text);
}

function readBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new InputError("INVALID_JSON", "请求体不是合法 JSON"));
      }
    });
    req.on("error", reject);
  });
}

export function createServer(store: Store): http.Server {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const path = url.pathname;
    const method = req.method ?? "GET";
    try {
      if (method === "GET" && path === "/health") {
        return send(res, 200, { ok: true });
      }

      if (method === "POST" && path === "/waveforms") {
        const body = await readBody(req);
        const obj = body as Record<string, unknown>;
        const waveform = validateWaveform(obj.waveform ?? obj);
        const id = store.saveWaveform(waveform, typeof obj.name === "string" ? obj.name : undefined);
        return send(res, 201, { waveformId: id });
      }

      if (method === "GET" && path === "/waveforms") {
        return send(res, 200, { waveforms: store.listWaveforms() });
      }

      if (method === "POST" && path === "/waveforms/demo") {
        const body = (await readBody(req)) as Record<string, unknown>;
        const params = validateParams(body.params ?? { bitPeriod: 10, parity: "none" });
        const bytes = body.bytes;
        if (!Array.isArray(bytes) || bytes.some((b) => !Number.isInteger(b) || b < 0 || b > 255)) {
          throw new InputError("INVALID_BYTES", "bytes 必须是 0..255 的整数数组");
        }
        const waveform = generateWaveform({
          bytes: bytes as number[],
          params,
          idleGapBits: typeof body.idleGapBits === "number" ? body.idleGapBits : 0,
        });
        const id = store.saveWaveform(waveform, typeof body.name === "string" ? body.name : "demo");
        return send(res, 201, { waveformId: id, waveform });
      }

      if (method === "POST" && path === "/params") {
        const params = validateParams(await readBody(req));
        const id = store.ensureParams(params);
        return send(res, 201, { paramsId: id, params });
      }

      if (method === "POST" && path === "/decode") {
        const body = (await readBody(req)) as Record<string, unknown>;
        const waveformId = Number(body.waveformId);
        if (!Number.isInteger(waveformId)) throw new InputError("INVALID_FORMAT", "缺少 waveformId");
        const waveform = store.getWaveform(waveformId);
        if (!waveform) throw new InputError("NOT_FOUND", `波形 ${waveformId} 不存在`);
        let paramsId: number;
        if (body.params !== undefined) {
          paramsId = store.ensureParams(validateParams(body.params));
        } else {
          paramsId = Number(body.paramsId);
          if (!Number.isInteger(paramsId)) throw new InputError("INVALID_FORMAT", "缺少 params 或 paramsId");
          if (!store.getParams(paramsId)) throw new InputError("NOT_FOUND", `参数版本 ${paramsId} 不存在`);
        }
        const params = store.getParams(paramsId)!;
        const result = decode(waveform, params);
        const decodeId = store.saveDecode(waveformId, paramsId, result);
        return send(res, 200, { decodeId, waveformId, paramsId, result });
      }

      const decodeMatch = path.match(/^\/decodes\/(\d+)(\/report)?$/);
      if (method === "GET" && decodeMatch) {
        const id = Number(decodeMatch[1]);
        const rec = store.getDecode(id);
        if (!rec) throw new InputError("NOT_FOUND", `解码结果 ${id} 不存在`);
        if (decodeMatch[2]) {
          const md = renderReport(rec.result, { waveformId: rec.waveformId, paramsId: rec.paramsId });
          return send(res, 200, md, "text/markdown; charset=utf-8");
        }
        return send(res, 200, { decodeId: id, ...rec });
      }

      if (method === "GET" && path === "/decodes") {
        return send(res, 200, { decodes: store.listDecodes() });
      }

      return send(res, 404, { error: { code: "NOT_FOUND", message: "路由不存在" } });
    } catch (err) {
      if (err instanceof InputError) {
        return send(res, 400, { error: { code: err.code, message: err.message } });
      }
      return send(res, 500, { error: { code: "INTERNAL", message: String(err) } });
    }
  });
}

if (require.main === module) {
  const store = new Store();
  const server = createServer(store);
  const portArg = process.env.PORT ? Number(process.env.PORT) : 0; // 默认选择空闲端口
  server.listen(portArg, "127.0.0.1", () => {
    const addr = server.address() as AddressInfo;
    console.log(`UART 后端已启动: http://127.0.0.1:${addr.port}`);
  });
}
