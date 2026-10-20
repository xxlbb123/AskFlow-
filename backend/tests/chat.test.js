const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');
const { createApp } = require('../src/app');
const { createConfig } = require('../src/config/env');
const { createArkClient } = require('../src/clients/ark.client');

const encoder = new TextEncoder();
const messages = [{ role: 'user', content: '你好' }];
const requestBody = JSON.stringify({ messages });
const sse = content => `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`;
const config = overrides => ({ ...createConfig({ ARK_API_KEY: 'test-key', ARK_MODEL_ID: 'test-model' }), ...overrides });

async function startServer(t, fetchImpl, overrides) {
  const server = http.createServer(createApp({ config: config(overrides), fetchImpl }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  });
  return `http://127.0.0.1:${server.address().port}`;
}

const postChat = (url, body = requestBody) => fetch(`${url}/api/chat`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body
});

test('configuration validates required values and numeric options', () => {
  assert.throws(() => createConfig({}), /ARK_API_KEY/);
  assert.throws(() => createConfig({ ARK_API_KEY: 'test-key', ARK_MODEL_ID: 'test-model', PORT: 'bad' }), /PORT/);
  assert.throws(() => createConfig({ ARK_API_KEY: 'test-key', ARK_MODEL_ID: 'test-model', ARK_REQUEST_TIMEOUT_MS: '0' }), /ARK_REQUEST_TIMEOUT_MS/);
  assert.throws(() => createConfig({ ARK_API_KEY: 'test-key', ARK_MODEL_ID: 'test-model', ARK_BASE_URL: 'ftp://example.com' }), /ARK_BASE_URL/);
  assert.equal(config().port, 3000);
});

test('health, CORS preflight and unknown routes work without contacting AI', async t => {
  const url = await startServer(t, () => assert.fail('AI must not be contacted'));
  const health = await fetch(`${url}/health`);
  assert.deepEqual(await health.json(), { status: 'ok', message: 'AI Chat API is running' });
  assert.equal(health.headers.get('access-control-allow-origin'), '*');
  const options = await fetch(`${url}/api/chat`, {
    method: 'OPTIONS', headers: { Origin: 'http://localhost:5173', 'Access-Control-Request-Method': 'POST' }
  });
  assert.equal(options.status, 204);
  const missing = await fetch(`${url}/api/missing`);
  assert.equal(missing.status, 404);
  assert.equal((await missing.json()).error.code, 'NOT_FOUND');
});

test('chat forwards split UTF-8 SSE bytes and keeps the existing frontend contract', async t => {
  const text = sse('你好，Vue！') + 'data: [DONE]\n\n';
  let payload;
  const url = await startServer(t, async (endpoint, options) => {
    assert.equal(endpoint, 'https://ark.cn-beijing.volces.com/api/v3/chat/completions');
    assert.equal(options.headers.Authorization, 'Bearer test-key');
    payload = JSON.parse(options.body);
    const body = new ReadableStream({ start(controller) {
      for (const byte of encoder.encode(text)) controller.enqueue(new Uint8Array([byte]));
      controller.close();
    } });
    return new Response(body, { headers: { 'Content-Type': 'text/event-stream' } });
  });
  const response = await postChat(url);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /text\/event-stream/);
  assert.equal(await response.text(), text);
  assert.deepEqual(payload, { model: 'test-model', messages, max_tokens: 4000, temperature: 0.7, stream: true });
});

test('invalid JSON, roles, content and empty messages are rejected before calling AI', async t => {
  const url = await startServer(t, () => assert.fail('Invalid input must not reach AI'));
  const badJson = await postChat(url, '{');
  assert.equal(badJson.status, 400);
  assert.equal((await badJson.json()).error.code, 'INVALID_JSON');
  for (const invalid of [[], [{ role: 'tool', content: 'injected' }], [{ role: 'user', content: 123 }], [{ role: 'user', content: '  ' }], [null]]) {
    const response = await postChat(url, JSON.stringify({ messages: invalid }));
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, 'INVALID_MESSAGES');
  }
  const wrongType = await fetch(`${url}/api/chat`, { method: 'POST', body: requestBody });
  assert.equal(wrongType.status, 415);
});

test('oversized JSON receives a readable 413 instead of an HTML error page', async t => {
  const url = await startServer(t, () => assert.fail('Oversized input must not reach AI'), { jsonBodyLimit: 100 });
  const response = await postChat(url, JSON.stringify({ messages: [{ role: 'user', content: 'x'.repeat(300) }] }));
  assert.equal(response.status, 413);
  assert.equal((await response.json()).error.code, 'PAYLOAD_TOO_LARGE');
});

test('upstream HTTP errors preserve the error code and never become successful SSE', async t => {
  const error = { code: 'InvalidEndpoint.ClosedEndpoint', message: 'Endpoint closed' };
  const url = await startServer(t, async () => Response.json({ error }, { status: 400 }));
  const response = await postChat(url);
  assert.equal(response.status, 400);
  assert.match(response.headers.get('content-type'), /application\/json/);
  assert.deepEqual(await response.json(), { error });
});

test('an HTTP 200 JSON error from upstream is rejected as a gateway error', async t => {
  const url = await startServer(t, async () => Response.json({ error: { code: 'Unavailable', message: 'Model unavailable' } }));
  const response = await postChat(url);
  assert.equal(response.status, 502);
  assert.equal((await response.json()).error.code, 'Unavailable');
});

test('connection failures return a readable gateway error', async t => {
  const url = await startServer(t, async () => { throw new TypeError('network unavailable'); });
  const response = await postChat(url);
  assert.equal(response.status, 502);
  assert.equal((await response.json()).error.code, 'UPSTREAM_UNAVAILABLE');
});

test('the Ark client also supports non-streaming tool-call responses', async () => {
  const tools = [{ type: 'function', function: { name: 'searchDocument' } }];
  const completion = { choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id: 'call_1' }] } }] };
  const client = createArkClient({ config: config(), fetchImpl: async (url, options) => {
    const payload = JSON.parse(options.body);
    assert.equal(payload.stream, false);
    assert.deepEqual(payload.tools, tools);
    return Response.json(completion);
  } });
  assert.deepEqual(await client.createCompletion({ model: 'test-model', messages, tools }), completion);
});

test('a timeout before response headers returns HTTP 504', async t => {
  const url = await startServer(t, (endpoint, { signal }) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  }), { requestTimeoutMs: 50 });
  const response = await postChat(url);
  assert.equal(response.status, 504);
  assert.equal((await response.json()).error.code, 'UPSTREAM_TIMEOUT');
});

test('a timeout during generation emits an SSE error and terminates the stream', async t => {
  const url = await startServer(t, async (endpoint, { signal }) => {
    const body = new ReadableStream({ start(controller) {
      controller.enqueue(encoder.encode(sse('开始回复')));
      signal.addEventListener('abort', () => controller.error(signal.reason), { once: true });
    } });
    return new Response(body, { headers: { 'Content-Type': 'text/event-stream' } });
  }, { requestTimeoutMs: 50 });
  const response = await postChat(url);
  assert.equal(response.status, 200);
  const text = await response.text();
  assert.ok(text.includes('开始回复'));
  assert.match(text, /UPSTREAM_TIMEOUT/);
  assert.ok(text.endsWith('data: [DONE]\n\n'));
});

test('disconnecting the frontend cancels the pending upstream generation', { timeout: 3000 }, async t => {
  let notifyAbort;
  const aborted = new Promise(resolve => { notifyAbort = resolve; });
  const url = await startServer(t, async (endpoint, { signal }) => {
    const body = new ReadableStream({ start(controller) {
      controller.enqueue(encoder.encode(sse('第一段')));
      signal.addEventListener('abort', () => {
        notifyAbort(signal.reason);
        controller.error(signal.reason);
      }, { once: true });
    } });
    return new Response(body, { headers: { 'Content-Type': 'text/event-stream' } });
  });
  const response = await postChat(url);
  const reader = response.body.getReader();
  await reader.read();
  await reader.cancel();
  assert.equal((await aborted).name, 'AbortError');
});

test('stream read failures are reported through SSE instead of crashing the server', async t => {
  const url = await startServer(t, async () => {
    const body = new ReadableStream({ pull(controller) { controller.error(new Error('upstream disconnected')); } });
    return new Response(body, { headers: { 'Content-Type': 'text/event-stream' } });
  });
  const response = await postChat(url);
  assert.equal(response.status, 200);
  assert.match(await response.text(), /UPSTREAM_STREAM_ERROR/);
  assert.equal((await fetch(`${url}/health`)).status, 200);
});
