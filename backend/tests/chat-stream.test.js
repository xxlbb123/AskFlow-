const assert = require('node:assert/strict');
const test = require('node:test');
const http = require('node:http');
const { createApp } = require('../src/app');
const { createConfig } = require('../src/config/env');
const { guardChatStream } = require('../src/utils/chat-stream');

const event = value => `data: ${JSON.stringify({ choices: [value] })}\n\n`;
const done = 'data: [DONE]\n\n';
const encoder = new TextEncoder();
async function serverFor(t, data) {
  t.mock.method(console, 'warn', () => {});
  const config = createConfig({ ARK_API_KEY: 'fake', ARK_MODEL_ID: 'fake' });
  const app = createApp({ config, fetchImpl: async () => new Response(data, { headers: { 'Content-Type': 'text/event-stream' } }) });
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  return fetch(`http://127.0.0.1:${server.address().port}/api/chat`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: [{ role: 'user', content: '问题' }] })
  });
}

test('reasoning-only output truncated at the token limit becomes an SSE error before DONE', async t => {
  const response = await serverFor(t, event({ delta: { reasoning_content: '仅思考内容', content: '' } })
    + event({ delta: {}, finish_reason: 'length' }) + done);
  const text = await response.text();
  assert.equal(response.status, 200);
  assert.match(text, /AI_OUTPUT_TRUNCATED/);
  assert.match(text, /没有生成回复正文/);
  assert.ok(text.indexOf('AI_OUTPUT_TRUNCATED') < text.indexOf('[DONE]'));
  assert.equal(text.match(/\[DONE\]/g).length, 1);
});

test('a role event and DONE without answer text become an explicit empty-reply error', async t => {
  const response = await serverFor(t, event({ delta: { role: 'assistant', content: ' \n ' }, finish_reason: 'stop' }) + done);
  const text = await response.text();
  assert.match(text, /EMPTY_AI_REPLY/);
  assert.match(text, /没有返回回复正文/);
});

test('a partial answer is preserved while truncation or a missing DONE is reported', async t => {
  const prefix = event({ delta: { content: '已经生成的正文' } });
  const truncated = await serverFor(t, prefix + event({ delta: {}, finish_reason: 'length' }) + done);
  const truncatedText = await truncated.text();
  assert.match(truncatedText, /已经生成的正文/);
  assert.match(truncatedText, /AI_OUTPUT_TRUNCATED/);
  const interrupted = await serverFor(t, prefix);
  const interruptedText = await interrupted.text();
  assert.match(interruptedText, /已经生成的正文/);
  assert.match(interruptedText, /UPSTREAM_INCOMPLETE_RESPONSE/);
});

test('a complete byte-split UTF-8 answer is unchanged and DONE cancels an otherwise open connection', async () => {
  let cancelled = false;
  const text = event({ delta: { reasoning_content: '思考过程' } }) + event({ delta: { content: '正常回答😀' } })
    + event({ delta: {}, finish_reason: 'stop' }) + done;
  const body = new ReadableStream({ start(controller) {
    for (const byte of encoder.encode(text)) controller.enqueue(Uint8Array.of(byte));
  }, cancel() { cancelled = true; } });
  let received = '';
  for await (const chunk of guardChatStream(body)) received += new TextDecoder().decode(chunk);
  assert.equal(received, text);
  assert.equal(cancelled, true);
  assert.equal(body.locked, false);
});

test('unexpected tool calls in the final stream are reported explicitly and release the reader', async t => {
  const tool = event({ delta: { tool_calls: [{ index: 0, id: 'call', type: 'function', function: { name: 'searchDocuments', arguments: '{}' } }] } });
  const text = await (await serverFor(t, tool + event({ delta: {}, finish_reason: 'tool_calls' }) + done)).text();
  assert.match(text, /AI_UNEXPECTED_TOOL_CALL/);
  assert.doesNotMatch(text, /EMPTY_AI_REPLY/);
  for (const stream of [tool, event({ delta: {}, finish_reason: 'tool_calls' }) + done]) {
    const body = new Response(stream).body;
    await assert.rejects(async () => {
      for await (const chunk of guardChatStream(body)) void chunk;
    }, error => error.code === 'AI_UNEXPECTED_TOOL_CALL');
    assert.equal(body.locked, false);
  }
});
