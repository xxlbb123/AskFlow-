const assert = require('node:assert/strict');
const test = require('node:test');
const http = require('node:http');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { createApp } = require('../src/app');
const { createConfig } = require('../src/config/env');
const { createDocumentService } = require('../src/services/document.service');
const { chunkText } = require('../src/documents/chunk');
const { retrieveBatch, estimateSize } = require('../src/documents/retrieve');
const { HttpError } = require('../src/utils/http-error');
const { createFakeEmbeddingClient, fixtureEmbedding } = require('./helpers/embedding');

async function setup(t, fetchImpl = () => assert.fail('upload must not call the chat model'), overrides = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'yuan-chat-docs-'));
  const config = { ...createConfig({ ARK_API_KEY: 'fake', ARK_MODEL_ID: 'fake-model' }), documentStorageDir: directory, ...overrides };
  const embeddingClient = createFakeEmbeddingClient({ dimensions: config.embeddingDimensions });
  const server = http.createServer(createApp({ config, fetchImpl, embeddingClient }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith('yuan-chat-docs-'));
    await fs.rm(directory, { recursive: true, force: true });
  });
  return { url: `http://127.0.0.1:${server.address().port}`, directory, config, embeddingClient };
}
const upload = (url, scopeId, text, name = '说明.md') => fetch(`${url}/api/files?${new URLSearchParams({ name, scopeId })}`, {
  method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: text
});
const chat = (url, scopeId, fileId, question = '什么时候保存会话？') => fetch(`${url}/api/chat`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ scopeId, fileIds: [fileId], messages: [{ role: 'user', content: question }] })
});
const reply = content => new Response(`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\ndata: [DONE]\n\n`, {
  headers: { 'Content-Type': 'text/event-stream' }
});

function failingEmbeddingClient(error) {
  const signals = [];
  const cancelled = [];
  return { signals, cancelled, embed(text, { signal }) {
    signals.push(signal);
    if (signals.length === 1) return Promise.reject(error);
    return new Promise((resolve, reject) => signal.addEventListener('abort', () => {
      cancelled.push(signal.reason);
      reject(signal.reason);
    }, { once: true }));
  } };
}

test('uploads persist original bytes and chunks; a fresh service reads them with scoped metadata', async t => {
  const { url, directory, config } = await setup(t);
  const scopeId = randomUUID();
  const text = '\ufeff# 聊天\r\n\r\n只有发送第一条消息才保存会话。\r\n';
  const response = await upload(url, scopeId, text);
  assert.equal(response.status, 201);
  const { file } = await response.json();
  assert.equal(file.name, '说明.md');
  assert.equal(file.status, 'ready');
  assert.equal(file.chunkCount, 1);
  assert.equal(file.chunks, undefined);
  assert.equal(await fs.readFile(path.join(directory, file.id, 'original.md'), 'utf8'), text);
  const embeddingClient = createFakeEmbeddingClient({ dimensions: config.embeddingDimensions });
  const fresh = createDocumentService({ config, embeddingClient });
  const saved = await fresh.read(file.id, scopeId);
  assert.equal(saved.chunks[0].startLine, 1);
  assert.equal(saved.chunks[0].endLine, 3);
  assert.equal(saved.chunks[0].section, '聊天');
  assert.match(saved.chunks[0].content, /第一条/);
  assert.deepEqual(saved.chunking, { strategy: 'fixed', chunkSize: 900, overlap: 160 });
  assert.equal(saved.version, 3);
  assert.deepEqual(saved.embedding, { model: config.embeddingModelId, dimensions: config.embeddingDimensions, profile: 'doubao-text-retrieval-v1' });
  assert.equal(saved.chunks[0].embedding.length, config.embeddingDimensions);
  await fresh.searchBatch({ fileId: file.id, scopeId, queries: ['保存条件', '保存条件'] });
  assert.deepEqual(embeddingClient.calls.map(call => call.role), ['query']);
  assert.equal((await fetch(`${url}/api/files/${file.id}?scopeId=${scopeId}`)).status, 200);
  assert.equal((await fetch(`${url}/api/files/${file.id}?scopeId=${randomUUID()}`)).status, 404);
  assert.equal((await chat(url, randomUUID(), file.id)).status, 404);
});

test('bad format, UTF-8, empty content, binary text, names and size are rejected without storing files', async t => {
  const { url, directory } = await setup(t, undefined, { fileMaxBytes: 64 });
  const cases = [
    ['', 'a.txt', 400, 'EMPTY_FILE'], ['  \n ', 'a.md', 400, 'EMPTY_FILE'],
    ['text', 'a.pdf', 415, 'UNSUPPORTED_FILE_TYPE'], [Buffer.from([0xff]), 'a.txt', 400, 'INVALID_FILE_ENCODING'],
    ['abc\0def', 'a.txt', 400, 'INVALID_FILE_CONTENT'], ['text', '../a.txt', 400, 'INVALID_FILENAME'],
    ['x'.repeat(65), 'a.txt', 413, 'PAYLOAD_TOO_LARGE']
  ];
  for (const [content, name, status, code] of cases) {
    const response = await upload(url, randomUUID(), content, name);
    assert.equal(response.status, status, name);
    assert.equal((await response.json()).error.code, code, name);
  }
  assert.deepEqual(await fs.readdir(directory), []);
  assert.equal((await upload(url, '../scope', 'abc')).status, 400);
  const wrongType = await fetch(`${url}/api/files`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: 'abc' });
  assert.equal(wrongType.status, 415);
});

test('a failed embedding batch cancels siblings, skips later batches and never stores a partial attachment', async t => {
  const { directory, config } = await setup(t);
  const error = new HttpError(502, '向量服务不可用', 'EMBEDDING_UNAVAILABLE');
  const controller = new AbortController();
  const embeddingClient = failingEmbeddingClient(error);
  const service = createDocumentService({ config, embeddingClient });
  await assert.rejects(service.save({ name: '说明.md', scopeId: randomUUID(), buffer: Buffer.from('设备说明'.repeat(1000)), signal: controller.signal }),
    failure => failure === error);
  assert.equal(embeddingClient.signals.length, 4);
  assert.ok(embeddingClient.signals.every(signal => signal.aborted && signal.reason === error));
  assert.deepEqual(embeddingClient.cancelled, [error, error, error]);
  assert.equal(controller.signal.aborted, false);
  assert.deepEqual(await fs.readdir(directory), []);
});

test('a failed query embedding cancels the other queries and preserves the saved document', async t => {
  const { url, config } = await setup(t);
  const scopeId = randomUUID();
  const { file } = await (await upload(url, scopeId, '# 设备说明\nE3 故障处理流程。')).json();
  const error = new HttpError(502, '向量服务不可用', 'EMBEDDING_UNAVAILABLE');
  const controller = new AbortController();
  const embeddingClient = failingEmbeddingClient(error);
  const service = createDocumentService({ config, embeddingClient });
  const document = await service.read(file.id, scopeId);
  await assert.rejects(service.searchBatch({ fileId: file.id, scopeId,
    queries: ['E3 含义', 'E3 处理步骤', '再次出现怎么办'], signal: controller.signal }), failure => failure === error);
  assert.equal(embeddingClient.signals.length, 3);
  assert.ok(embeddingClient.signals.every(signal => signal.aborted && signal.reason === error));
  assert.deepEqual(embeddingClient.cancelled, [error, error]);
  assert.equal(controller.signal.aborted, false);
  assert.deepEqual(await service.read(file.id, scopeId), document);
});

test('cancelling document indexing stops later batches without saving a file', async t => {
  const { directory, config } = await setup(t);
  const controller = new AbortController();
  const reason = new DOMException('取消上传', 'AbortError');
  const embeddingClient = createFakeEmbeddingClient({ onEmbed: () => controller.abort(reason) });
  const service = createDocumentService({ config, embeddingClient });
  await assert.rejects(service.save({ name: '说明.md', scopeId: randomUUID(), buffer: Buffer.from('设备说明'.repeat(1000)), signal: controller.signal }),
    failure => failure === reason);
  assert.equal(embeddingClient.calls.length, 1);
  assert.deepEqual(await fs.readdir(directory), []);
});

test('changing model or dimensions rejects saved indexes before generating query embeddings', async t => {
  const { url, config } = await setup(t);
  const scopeId = randomUUID();
  const { file } = await (await upload(url, scopeId, '# 文档\n已建立向量索引。')).json();
  for (const override of [{ embeddingModelId: 'other-model' }, { embeddingDimensions: 2048 }]) {
    const embeddingClient = createFakeEmbeddingClient();
    const service = createDocumentService({ config: { ...config, ...override }, embeddingClient });
    await assert.rejects(service.searchBatch({ fileId: file.id, scopeId, queries: ['资料'] }),
      error => error.status === 409 && error.code === 'DOCUMENT_REINDEX_REQUIRED');
    assert.equal(embeddingClient.calls.length, 0);
  }
});

test('a file at the upload limit passes the MCP JSON transport and retains its original bytes', async t => {
  const { url, config, directory } = await setup(t);
  const bytes = Buffer.alloc(config.fileMaxBytes, 'x');
  const response = await upload(url, randomUUID(), bytes, '上限.txt');
  assert.equal(response.status, 201, await response.clone().text());
  const { file } = await response.json();
  assert.equal(file.size, bytes.length);
  assert.ok(file.chunkCount > 1);
  assert.deepEqual(await fs.readFile(path.join(directory, file.id, 'original.txt')), bytes);
});

test('legacy documents keep their original chunks and source locations after the MCP refactor', async t => {
  const { url, config, directory } = await setup(t);
  const scopeId = randomUUID();
  const file = (await (await upload(url, scopeId, '# 旧文档\n\n以前上传的资料。')).json()).file;
  const location = path.join(directory, file.id, 'document.json');
  const legacy = JSON.parse(await fs.readFile(location, 'utf8'));
  legacy.version = 1;
  delete legacy.chunking;
  delete legacy.embedding;
  legacy.chunks = [
    { id: 'chunk-1', section: '旧文档', startLine: 1, endLine: 1, content: '# 旧文档' },
    { id: 'chunk-2', section: '旧文档', startLine: 3, endLine: 3, content: '以前上传的资料。' }
  ];
  await fs.writeFile(location, JSON.stringify(legacy));
  const service = createDocumentService({ config });
  assert.deepEqual((await service.read(file.id, scopeId)).chunks, legacy.chunks);
  await assert.rejects(service.searchBatch({ fileId: file.id, scopeId, queries: ['资料'] }),
    error => error.status === 409 && error.code === 'DOCUMENT_REINDEX_REQUIRED');
  const result = await service.readChunks({ fileId: file.id, scopeId, startChunk: 2 });
  assert.equal(result.sources[0].chunkId, 'chunk-2');
  assert.equal(result.sources[0].startLine, 3);
  const metadata = await (await fetch(`${url}/api/files/${file.id}?scopeId=${scopeId}`)).json();
  assert.equal(metadata.file.chunkCount, 2);
});

test('fixed windows overlap without cutting Unicode characters or duplicating a covered final chunk', () => {
  const original = '😀'.repeat(2000);
  const chunks = chunkText(original);
  assert.deepEqual(chunks.map(chunk => Array.from(chunk.content).length), [900, 900, 520]);
  assert.equal(chunks[0].content + Array.from(chunks[1].content).slice(160).join('')
    + Array.from(chunks[2].content).slice(160).join(''), original);
  assert.ok(chunks.every(chunk => chunk.startLine === 1 && chunk.endLine === 1));
  assert.equal(chunkText('a'.repeat(900)).length, 1);
  assert.equal(chunkText('a'.repeat(1600)).length, 2);
  assert.deepEqual(chunkText(' \n\t '), []);
  assert.throws(() => chunkText('abc', { chunkSize: 10, overlap: 10 }), RangeError);
});

test('overlapping windows retain source lines and starting sections, ignoring headings inside code fences', () => {
  const chunks = chunkText('abc\r\ndef\n ghi \n', { chunkSize: 8, overlap: 2 });
  assert.deepEqual(chunks.map(({ content, startLine, endLine }) => ({ content, startLine, endLine })), [
    { content: 'abc\ndef', startLine: 1, endLine: 2 }, { content: 'f\n ghi', startLine: 2, endLine: 3 }
  ]);
  const markdown = '# 父标题\n\n## 子标题\n正文\n\n```md\n# 代码中的标题\n```\n\n' + '正文'.repeat(80);
  const sections = chunkText(markdown, { chunkSize: 30, overlap: 8 }).map(chunk => chunk.section);
  assert.ok(sections.includes('父标题 / 子标题'));
  assert.ok(sections.every(section => !section.includes('代码中的标题')));
});

test('vectors select short file context and long file concepts under the material budget', () => {
  const document = { id: randomUUID(), name: '规则.md', chunks: chunkText('# 保存条件\n发送第一条消息才保存会话。') };
  const index = doc => doc.chunks.forEach(chunk => { chunk.embedding = fixtureEmbedding(chunk.content, { role: 'corpus' }); });
  index(document);
  assert.equal(retrieveBatch(document, ['任意问题'], 12000, [fixtureEmbedding('任意问题')]).mode, 'full');
  const long = { ...document, chunks: chunkText(('## 天气\n今天晴天，可以出去散步。\n\n').repeat(120) + '\n## 会话保存\n发送第一条消息才保存会话，空白草稿不进侧栏。') };
  index(long);
  const result = retrieveBatch(long, ['会话保存的条件'], 6000, [fixtureEmbedding('会话保存的条件')]);
  assert.equal(result.mode, 'retrieval');
  assert.match(result.sources[0].text, /会话/);
  assert.ok(estimateSize(result.sources) <= 6000);
  assert.deepEqual(retrieveBatch(long, ['不存在的火箭预算'], 6000, [fixtureEmbedding('不存在的火箭预算')]).sources, []);
});

test('file chat executes Function Calling then streams a grounded answer and server-generated source locations', async t => {
  const requests = [];
  let fileId;
  const { url } = await setup(t, async (endpoint, options) => {
    const payload = JSON.parse(options.body);
    requests.push(payload);
    if (!payload.stream) return Response.json({ choices: [{ message: {
      role: 'assistant', content: null, reasoning_content: '查阅文件',
      tool_calls: [{ id: 'call-search', type: 'function', function: { name: 'searchDocuments', arguments: JSON.stringify({ fileId, queries: ['会话 保存 第一条消息'] }) } }]
    } }] });
    assert.match(payload.messages[0].content, /第一条消息/);
    assert.match(payload.messages[0].content, /"mode":"full"/);
    assert.equal(payload.tools, undefined);
    return reply('发送第一条消息后保存。[1]');
  });
  const scopeId = randomUUID();
  fileId = (await (await upload(url, scopeId, '# 会话规则\n\n只有发送第一条消息才保存会话。')).json()).file.id;
  const response = await chat(url, scopeId, fileId);
  assert.equal(response.status, 200);
  const body = await response.text();
  const event = body.split('\n').filter(line => line.startsWith('data: {')).map(line => JSON.parse(line.slice(6))).find(event => event.type === 'sources');
  assert.equal(event.sources[0].name, '说明.md');
  assert.equal(event.sources[0].startLine, 1);
  assert.equal(event.sources[0].endLine, 3);
  assert.equal(event.sources[0].index, 1);
  assert.match(body, /发送第一条消息后保存/);
  assert.match(body, /\[DONE\]/);
  assert.equal(requests.length, 2);
  assert.equal(requests[0].tools[0].function.name, 'searchDocuments');
  assert.equal(requests[0].messages.some(message => message.content?.includes('只有发送第一条消息')), false);
  assert.equal(requests[1].tool_choice, undefined);
  await (await chat(url, scopeId, fileId, '那空白聊天呢？')).text();
  assert.equal(requests.length, 4);
});

test('invalid tool names, arguments, foreign file IDs and duplicate call IDs are rejected before generating an answer', async t => {
  let responseMessage;
  let requests = 0;
  const { url } = await setup(t, async () => {
    requests++;
    return Response.json({ choices: [{ message: responseMessage }] });
  });
  const scopeId = randomUUID();
  const fileId = (await (await upload(url, scopeId, '有效文件内容')).json()).file.id;
  const valid = { id: 'call', type: 'function', function: { name: 'searchDocuments', arguments: JSON.stringify({ fileId, queries: ['内容'] }) } };
  const invalid = [null, { ...valid, function: { ...valid.function, name: 'readFile' } },
    { ...valid, function: { name: 'ingestDocuments', arguments: JSON.stringify({ documents: [{ name: '不应导入.txt', dataBase64: 'eA==' }] }) } },
    { ...valid, function: { ...valid.function, arguments: 'bad json' } },
    { ...valid, function: { ...valid.function, arguments: JSON.stringify({ fileId: randomUUID(), queries: ['内容'] }) } },
    { ...valid, function: { ...valid.function, arguments: JSON.stringify({ fileId, queries: ['内容'], path: '../.env' }) } }];
  for (const call of invalid) {
    responseMessage = { tool_calls: [call] };
    const response = await chat(url, scopeId, fileId);
    assert.equal(response.status, 502);
    assert.equal((await response.json()).error.code, 'INVALID_TOOL_CALL');
  }
  responseMessage = { tool_calls: [valid, valid] };
  assert.equal((await chat(url, scopeId, fileId)).status, 502);
  assert.equal(requests, invalid.length + 1);
});

test('models that omit tool calls still receive program-retrieved evidence before the final answer', async t => {
  let requests = 0;
  const { url } = await setup(t, async (endpoint, options) => {
    const payload = JSON.parse(options.body);
    requests++;
    if (!payload.stream) return Response.json({ choices: [{ message: { content: '不能把这个无依据的结果直接显示' } }] });
    assert.match(payload.messages[0].content, /原文证据/);
    return reply('有依据的回复');
  });
  const scopeId = randomUUID();
  const fileId = (await (await upload(url, scopeId, '原文证据')).json()).file.id;
  const text = await (await chat(url, scopeId, fileId)).text();
  assert.match(text, /有依据的回复/);
  assert.doesNotMatch(text, /不能把这个/);
  assert.equal(requests, 2);
});

test('file chat validates scope and input size without contacting AI', async t => {
  const { url } = await setup(t, undefined, { inputBudget: 200 });
  const scopeId = randomUUID();
  const fileId = (await (await upload(url, scopeId, '文件内容')).json()).file.id;
  const invalid = await fetch(`${url}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }], fileIds: ['../secret'] }) });
  assert.equal(invalid.status, 400);
  const response = await chat(url, scopeId, fileId, '长问题'.repeat(200));
  assert.equal(response.status, 413);
  assert.equal((await response.json()).error.code, 'INPUT_BUDGET_EXCEEDED');
});

test('disconnecting during the non-streaming tool decision aborts that upstream request', async t => {
  let upstreamSignal;
  let observed;
  const called = new Promise(resolve => { observed = resolve; });
  const { url } = await setup(t, (endpoint, options) => {
    upstreamSignal = options.signal;
    observed();
    return new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true }));
  });
  const scopeId = randomUUID();
  const fileId = (await (await upload(url, scopeId, '文件内容')).json()).file.id;
  const controller = new AbortController();
  const pending = fetch(`${url}/api/chat`, { method: 'POST', signal: controller.signal, headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: [{ role: 'user', content: '内容' }], scopeId, fileIds: [fileId] }) });
  await called;
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  await new Promise(resolve => upstreamSignal.aborted ? resolve() : upstreamSignal.addEventListener('abort', resolve, { once: true }));
  assert.equal(upstreamSignal.aborted, true);
});
