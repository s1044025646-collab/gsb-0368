import * as fs from "node:fs";
import { decode } from "./decoder";
import { generateWaveform } from "./generator";
import { validateParams } from "./params";
import { renderReport } from "./report";
import { Store } from "./store";
import { InputError, RxParams } from "./types";
import { validateWaveform } from "./waveform";

function usage(): never {
  console.log(`用法: node dist/src/cli.js <命令> [选项]

命令:
  save-waveform <file.json> [--name 名称]     保存波形（JSON 文件）
  demo --bytes 00,41,FF [--params B,parity] [--name 名称] [--idle-gap N]
                                              生成理想演示波形并保存
  set-params --bit-period 10 --parity none    设置接收参数（返回参数版本 ID）
  decode --waveform ID [--params-id ID | --bit-period B --parity P]
                                              解码并保存分析结果
  explain --decode ID                         查询采样解释（JSON）
  report --decode ID [--out file.md]          导出 Markdown 报告
  list                                        列出波形与解码记录
  serve [--port N]                            启动 HTTP API（默认空闲端口）`);
  process.exit(1);
}

function argValue(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

function parseParams(args: string[]): RxParams {
  const combined = argValue(args, "--params");
  if (combined) {
    const [b, p] = combined.split(",");
    return validateParams({ bitPeriod: Number(b), parity: p ?? "none" });
  }
  return validateParams({
    bitPeriod: Number(argValue(args, "--bit-period") ?? "10"),
    parity: argValue(args, "--parity") ?? "none",
  });
}

function main(): void {
  const args = process.argv.slice(2);
  const cmd = args.shift();
  if (!cmd) usage();
  const store = new Store();

  try {
    switch (cmd) {
      case "save-waveform": {
        const file = args[0];
        if (!file) usage();
        const waveform = validateWaveform(JSON.parse(fs.readFileSync(file, "utf8")));
        const id = store.saveWaveform(waveform, argValue(args, "--name"));
        console.log(`waveformId=${id}`);
        break;
      }
      case "demo": {
        const bytesArg = argValue(args, "--bytes") ?? "00,41,FF";
        const bytes = bytesArg.split(",").map((s) => parseInt(s, 16));
        const params = parseParams(args);
        const waveform = generateWaveform({
          bytes,
          params,
          idleGapBits: Number(argValue(args, "--idle-gap") ?? "0"),
        });
        const id = store.saveWaveform(waveform, argValue(args, "--name") ?? "demo");
        console.log(`waveformId=${id}`);
        console.log(JSON.stringify(waveform));
        break;
      }
      case "set-params": {
        const params = parseParams(args);
        const id = store.ensureParams(params);
        console.log(`paramsId=${id}`);
        break;
      }
      case "decode": {
        const waveformId = Number(argValue(args, "--waveform"));
        const waveform = store.getWaveform(waveformId);
        if (!waveform) throw new InputError("NOT_FOUND", `波形 ${waveformId} 不存在`);
        let paramsId: number;
        const pidArg = argValue(args, "--params-id");
        if (pidArg !== undefined) {
          paramsId = Number(pidArg);
          if (!store.getParams(paramsId)) throw new InputError("NOT_FOUND", `参数版本 ${paramsId} 不存在`);
        } else {
          paramsId = store.ensureParams(parseParams(args));
        }
        const result = decode(waveform, store.getParams(paramsId)!);
        const decodeId = store.saveDecode(waveformId, paramsId, result);
        console.log(`decodeId=${decodeId}`);
        console.log(JSON.stringify(result, null, 2));
        break;
      }
      case "explain": {
        const id = Number(argValue(args, "--decode"));
        const rec = store.getDecode(id);
        if (!rec) throw new InputError("NOT_FOUND", `解码结果 ${id} 不存在`);
        console.log(JSON.stringify(rec, null, 2));
        break;
      }
      case "report": {
        const id = Number(argValue(args, "--decode"));
        const rec = store.getDecode(id);
        if (!rec) throw new InputError("NOT_FOUND", `解码结果 ${id} 不存在`);
        const md = renderReport(rec.result, { waveformId: rec.waveformId, paramsId: rec.paramsId });
        const out = argValue(args, "--out");
        if (out) {
          fs.writeFileSync(out, md, "utf8");
          console.log(`已导出 ${out}`);
        } else {
          console.log(md);
        }
        break;
      }
      case "list": {
        console.log("波形:", JSON.stringify(store.listWaveforms(), null, 2));
        console.log("解码:", JSON.stringify(store.listDecodes(), null, 2));
        break;
      }
      case "serve": {
        // 延迟加载避免循环
        const { createServer } = require("./api") as typeof import("./api");
        const server = createServer(store);
        const port = Number(argValue(args, "--port") ?? process.env.PORT ?? "0");
        server.listen(port, "127.0.0.1", () => {
          const addr = server.address() as { port: number };
          console.log(`UART 后端已启动: http://127.0.0.1:${addr.port}`);
        });
        return; // 不关闭 store
      }
      default:
        usage();
    }
  } catch (err) {
    if (err instanceof InputError) {
      console.error(`输入被拒绝 [${err.code}]: ${err.message}`);
      process.exit(2);
    }
    throw err;
  } finally {
    if (cmd !== "serve") store.close();
  }
}

main();
