#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { AppDatabase } from '../db/database.js';
import { createApiServer, pickFreePort } from '../api/server.js';
import { generateWaveform } from '../core/generator.js';
import { decodeWaveform } from '../core/decoder.js';
import { ValidationError } from '../core/types.js';
import { exportReport } from '../service/report.js';
import { runAndStoreAnalysis } from '../service/analysis.js';

interface Args {
  positional: string[];
  flags: Map<string, string>;
}

function parseArgs(argv: string[]): Args {
  const positional: string[] = [];
  const flags = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        flags.set(key, 'true');
      } else {
        flags.set(key, next);
        i++;
      }
    } else {
      positional.push(a);
    }
  }
  return { positional, flags };
}

const DATA_DIR = resolve(process.env.UART_DATA_DIR ?? join(process.cwd(), 'data'));
const DB_PATH = join(DATA_DIR, 'uart.sqlite');

function openDb(path = DB_PATH): AppDatabase {
  return new AppDatabase(path);
}

async function main(): Promise<void> {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  const command = positional[0] ?? 'help';

  switch (command) {
    case 'serve': {
      const db = openDb();
      const server = createApiServer(db);
      const port = flags.has('port') ? Number(flags.get('port')) : await pickFreePort();
      server.listen(port, '127.0.0.1', () => {
        console.log(`UART 后端已启动: http://127.0.0.1:${port}`);
        console.log(`数据目录: ${DATA_DIR}`);
      });
      break;
    }

    case 'generate': {
      const waveform = generateWaveform({
        name: flags.get('name') ?? 'CLI 演示波形',
        bytes: (flags.get('bytes') ?? '00,41,FF')
          .split(',')
          .map((s) => parseInt(s.trim(), 16)),
        bitTicks: Number(flags.get('bit-ticks') ?? '10'),
        parity: (flags.get('parity') ?? 'none') as 'none' | 'even' | 'odd',
        gapTicks: flags.has('gap') ? Number(flags.get('gap')) : undefined,
        badStopIndices: flags.has('bad-stop')
          ? flags.get('bad-stop')!.split(',').map((s) => Number(s))
          : undefined,
        glitches: flags.has('glitch-after')
          ? flags
              .get('glitch-after')!
              .split(',')
              .map((s) => ({ afterFrameIndex: Number(s) }))
          : undefined,
        truncateLastAtBit: flags.has('truncate-bit')
          ? Number(flags.get('truncate-bit'))
          : undefined,
      });
      const output = JSON.stringify(waveform, null, 2);
      if (flags.has('out')) writeFileSync(flags.get('out')!, output, 'utf8');
      if (flags.has('save-db')) {
        const db = openDb();
        const saved = db.saveWaveform(flags.get('name') ?? 'CLI 演示波形', waveform);
        console.log(`已保存波形 #${saved.id}`);
        db.close();
      }
      console.log(output);
      break;
    }

    case 'save-waveform': {
      const file = flags.get('file');
      if (!file) throw new ValidationError('FILE_REQUIRED', '需要 --file <path>');
      const waveform = JSON.parse(readFileSync(file, 'utf8'));
      const db = openDb();
      const saved = db.saveWaveform(flags.get('name') ?? file, waveform);
      console.log(`已保存波形 #${saved.id}`);
      db.close();
      break;
    }

    case 'decode': {
      const bitTicks = Number(flags.get('bit-ticks') ?? '10');
      const parity = (flags.get('parity') ?? 'none') as 'none' | 'even' | 'odd';
      if (flags.has('waveform-id')) {
        const db = openDb();
        const { analysisId, result } = runAndStoreAnalysis(db, Number(flags.get('waveform-id')), {
          bitTicks,
          parity,
        });
        console.log(`分析 #${analysisId}`);
        console.log(exportReport(result, (flags.get('format') as 'json' | 'text' | 'csv') ?? 'text'));
        db.close();
      } else {
        const file = flags.get('file');
        if (!file) throw new ValidationError('FILE_REQUIRED', '需要 --file <path> 或 --waveform-id');
        const waveform = JSON.parse(readFileSync(file, 'utf8'));
        const result = decodeWaveform(waveform, { bitTicks, parity });
        console.log(exportReport(result, (flags.get('format') as 'json' | 'text' | 'csv') ?? 'text'));
      }
      break;
    }

    case 'report': {
      if (!flags.has('waveform-id')) throw new ValidationError('ID_REQUIRED', '需要 --waveform-id');
      const db = openDb();
      const { result } = runAndStoreAnalysis(db, Number(flags.get('waveform-id')), {
        bitTicks: Number(flags.get('bit-ticks') ?? '10'),
        parity: (flags.get('parity') ?? 'none') as 'none' | 'even' | 'odd',
      });
      console.log(exportReport(result, (flags.get('format') as 'json' | 'text' | 'csv') ?? 'text'));
      db.close();
      break;
    }

    case 'demo': {
      await runDemo(flags);
      break;
    }

    default:
      printHelp();
  }
}

function printHelp(): void {
  console.log(`UART 数字波形教学后端

用法:
  uart serve [--port 3000]
  uart generate --bytes 00,41,FF --bit-ticks 10 [--parity even|odd|none]
               [--gap N] [--bad-stop 1] [--glitch-after 0]
               [--truncate-bit 9] [--out wave.json] [--save-db]
  uart save-waveform --file wave.json [--name 名称]
  uart decode --file wave.json --bit-ticks 10 [--parity none] [--format text|json|csv]
  uart decode --waveform-id 1 --bit-ticks 10 [--parity even]
  uart report --waveform-id 1 --bit-ticks 10 --parity none [--format text|json|csv]
  uart demo [--decode] [--print-report]

环境变量:
  UART_DATA_DIR   数据目录（默认 ./data，SQLite 存于其中）
`);
}

async function runDemo(flags: Map<string, string>): Promise<void> {
  const db = openDb();
  console.log('=== 场景 1: B=10, 无校验, 背靠背 0x00 0x41 0xFF ===');
  const wf1 = generateWaveform({ name: 'demo-basic', bytes: [0x00, 0x41, 0xff], bitTicks: 10, gapTicks: 0 });
  const s1 = db.saveWaveform('demo-basic', wf1);
  const a1 = runAndStoreAnalysis(db, s1.id, { bitTicks: 10, parity: 'none' });
  console.log(exportReport(a1.result, 'text'));

  console.log('\n=== 场景 2: 偶校验 + 第二帧坏停止位 + 额外空闲 ===');
  const wf2 = generateWaveform({
    name: 'demo-even-badstop',
    bytes: [0x00, 0x41],
    bitTicks: 10,
    parity: 'even',
    gapTicks: 25,
    badStopIndices: [1],
  });
  const s2 = db.saveWaveform('demo-even-badstop', wf2);
  const a2 = runAndStoreAnalysis(db, s2.id, { bitTicks: 10, parity: 'even' });
  console.log(exportReport(a2.result, 'text'));

  console.log('\n=== 场景 3: 奇校验 ===');
  const wf3 = generateWaveform({ name: 'demo-odd', bytes: [0x41, 0xff], bitTicks: 10, parity: 'odd', gapTicks: 10 });
  const s3 = db.saveWaveform('demo-odd', wf3);
  const a3 = runAndStoreAnalysis(db, s3.id, { bitTicks: 10, parity: 'odd' });
  console.log(exportReport(a3.result, 'text'));

  console.log('\n=== 场景 4: 帧间短噪声脉冲（中心已回高）===');
  const wf4 = generateWaveform({
    name: 'demo-glitch',
    bytes: [0x55],
    bitTicks: 10,
    gapTicks: 40,
    glitches: [{ afterFrameIndex: 0, offsetTicks: 20, widthTicks: 2 }],
  });
  const s4 = db.saveWaveform('demo-glitch', wf4);
  const a4 = runAndStoreAnalysis(db, s4.id, { bitTicks: 10, parity: 'none' });
  console.log(exportReport(a4.result, 'text'));

  console.log('\n=== 场景 5: 末帧在停止位前截断 ===');
  const wf5 = generateWaveform({
    name: 'demo-truncated',
    bytes: [0x41, 0x00],
    bitTicks: 10,
    gapTicks: 10,
    truncateLastAtBit: 9,
  });
  const s5 = db.saveWaveform('demo-truncated', wf5);
  const a5 = runAndStoreAnalysis(db, s5.id, { bitTicks: 10, parity: 'none' });
  console.log(exportReport(a5.result, 'text'));

  console.log('\n=== 持久化检查: 重新打开数据库并查询旧分析 ===');
  db.close();
  const db2 = openDb();
  const reloaded = db2.getAnalysis(a1.analysisId);
  console.log(reloaded ? `分析 #${a1.analysisId} 仍可查询，参数版本=${reloaded.paramsVersion}` : '丢失!');
  db2.close();
}

main().catch((err: unknown) => {
  if (err instanceof ValidationError) {
    console.error(`输入拒绝 [${err.code}]: ${err.message}`);
  } else {
    console.error('错误:', (err as Error).message);
  }
  process.exitCode = 1;
});
