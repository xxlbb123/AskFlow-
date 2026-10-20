const assert = require('node:assert/strict');
const test = require('node:test');
const http = require('node:http');
const path = require('node:path');
const { once } = require('node:events');
const { spawn } = require('node:child_process');

function launch(t, port) {
  // 使用虚拟密钥，只验证实际入口启动，不调用模型。
  const child = spawn(process.execPath, [path.resolve(__dirname, '../index.js')], {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, PORT: String(port), ARK_API_KEY: 'test-key', ARK_MODEL_ID: 'test-model' },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', data => { stdout += data; });
  child.stderr.on('data', data => { stderr += data; });
  const closed = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ code, signal, stdout, stderr }));
  });
  t.after(async () => {
    if (child.pid && child.exitCode === null && child.signalCode === null) child.kill();
    await closed.catch(() => {});
  });
  return { child, closed, output: () => ({ stdout, stderr }) };
}

test('the real entrypoint reports an occupied port without reading a null server address', { timeout: 10000 }, async t => {
  const occupied = http.createServer();
  occupied.listen(0);
  await once(occupied, 'listening');
  t.after(() => new Promise(resolve => occupied.close(resolve)));
  const { closed } = launch(t, occupied.address().port);
  const result = await closed;
  assert.equal(result.code, 1);
  assert.match(result.stderr, /端口 \d+ 已被占用/);
  assert.doesNotMatch(result.stderr, /TypeError|Cannot read properties/);
  assert.doesNotMatch(result.stdout, /AI Chat API is running/);
});

test('the real entrypoint logs its assigned port and serves health and file routes after successful startup', { timeout: 10000 }, async t => {
  const process = launch(t, 0);
  const url = await new Promise((resolve, reject) => {
    const check = () => {
      const match = process.output().stdout.match(/http:\/\/localhost:(\d+)/);
      if (match) resolve(match[0]);
    };
    process.child.stdout.on('data', check);
    process.closed.then(result => reject(new Error(`后端提前退出：${result.stderr}`)), reject);
    check();
  });
  assert.notEqual(new URL(url).port, '0');
  const health = await fetch(`${url}/health`);
  assert.equal(health.status, 200);
  assert.equal((await health.json()).status, 'ok');
  const upload = await fetch(`${url}/api/files?name=test.txt&scopeId=7d743c5a-7b1d-4c55-bb85-65b245b4d17a`, {
    method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: ''
  });
  assert.equal(upload.status, 400);
  assert.equal((await upload.json()).error.code, 'EMPTY_FILE');
  assert.equal(process.output().stderr, '');
});
