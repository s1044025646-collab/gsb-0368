import { spawn } from 'node:child_process';

const srv = spawn(process.execPath, ['dist/cli/index.js', 'serve', '--port', '38123'], {
  stdio: 'ignore',
});
await new Promise((r) => setTimeout(r, 1500));

try {
  const health = await fetch('http://127.0.0.1:38123/health').then((r) => r.json());
  console.log('health:', JSON.stringify(health));

  const gen = await fetch('http://127.0.0.1:38123/waveforms/generate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'api-smoke', bytes: [0x00, 0x41, 0xff], bitTicks: 10 }),
  }).then((r) => r.json());
  console.log('generated id:', gen.id);

  const dec = await fetch(`http://127.0.0.1:38123/waveforms/${gen.id}/decode`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ bitTicks: 10, parity: 'none' }),
  }).then((r) => r.json());
  console.log('frames:', dec.result.frames.length, 'analysisId:', dec.analysisId);

  const report = await fetch(
    `http://127.0.0.1:38123/waveforms/${gen.id}/report?bitTicks=10&parity=none&format=text`,
  ).then((r) => r.text());
  console.log('report head:', report.split('\n')[0]);

  const bad = await fetch(`http://127.0.0.1:38123/waveforms/${gen.id}/decode`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ bitTicks: 3, parity: 'none' }),
  });
  console.log('odd B status:', bad.status, JSON.stringify(await bad.json()));
} finally {
  srv.kill();
}
