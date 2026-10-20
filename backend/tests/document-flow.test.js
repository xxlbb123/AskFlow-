const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { createConfig } = require('../src/config/env');
const { createDocumentService } = require('../src/services/document.service');
const { createChatService } = require('../src/services/chat.service');
const { createArkClient } = require('../src/clients/ark.client');
const { openDocumentMcp } = require('../src/mcp/document.client');
const { createFakeEmbeddingClient } = require('./helpers/embedding');

const event = choice => `data: ${JSON.stringify({ choices: [choice] })}\n\n`;
const reply = text => new Response(event({ delta: { content: text }, finish_reason: 'stop' }) + 'data: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } });
const text = '# MarineGen\n\nMarineGen 是海洋任务系统。\n\n# 天气\n'
  + ('今天晴天，可以出去散步。'.repeat(20) + '\n\n').repeat(60)
  + '# 音频原型\n\n音频原型是音频特征的代表。\n\n# 训练方式\n\n训练方式采用弱配对数据。';
async function setup(t, respond, overrides = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'yuan-chat-flow-'));
  const config = { ...createConfig({ ARK_API_KEY: 'fake', ARK_MODEL_ID: 'fake' }), documentStorageDir: directory, ...overrides };
  const documentService = createDocumentService({ config,
    embeddingClient: createFakeEmbeddingClient({ dimensions: config.embeddingDimensions }) });
  const scopeId = randomUUID();
  const file = await documentService.save({ name: 'MarineGen.md', scopeId, buffer: Buffer.from(text) });
  const payloads = [];
  let searches = 0;
  let closed = false;
  const arkClient = createArkClient({ config, fetchImpl: async (endpoint, options) => {
    const payload = JSON.parse(options.body);
    payloads.push(payload);
    return respond(payload, payloads.length, file.id, options.signal);
  } });
  const service = createChatService({ config, arkClient, documentService,
    openMcp: async options => {
      const mcp = await openDocumentMcp({ ...options, documentService: { ...documentService,
        searchBatch: async args => { searches++; return documentService.searchBatch(args); } } });
      mcp.client.onclose = () => { closed = true; };
      return mcp;
    } });
  t.after(async () => {
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith('yuan-chat-flow-'));
    await fs.rm(directory, { recursive: true, force: true });
  });
  return { payloads, searches: () => searches, closed: () => closed,
    open: options => service.openStream([{ role: 'user', content: 'MarineGen 是什么？音频原型是什么？' }], { fileIds: [file.id], scopeId, ...options }) };
}
const call = (fileId, queries, id) => ({ id, type: 'function', function: { name: 'searchDocuments', arguments: JSON.stringify({ fileId, queries }) } });
const plan = calls => Response.json({ choices: [{ message: { role: 'assistant', content: null, tool_calls: calls } }] });
const ready = () => Response.json({ choices: [{ message: { role: 'assistant', content: '资料已足够。' } }] });
async function collect(opened) {
  let text = '';
  for await (const chunk of opened.body) text += new TextDecoder().decode(chunk);
  return text;
}

test('each model tool call gets its own MCP result before a tools-free final stream', async t => {
  const flow = await setup(t, (payload, number, fileId) => {
    if (number === 1) return plan([call(fileId, ['MarineGen 定义'], 'first'), call(fileId, ['音频原型定义'], 'second')]);
    if (!payload.stream) {
      assert.equal(payload.messages.at(-2).tool_call_id, 'first');
      assert.equal(payload.messages.at(-1).tool_call_id, 'second');
      assert.deepEqual(JSON.parse(payload.messages.at(-2).content).queries.map(item => item.query), ['MarineGen 定义']);
      assert.deepEqual(JSON.parse(payload.messages.at(-1).content).queries.map(item => item.query), ['音频原型定义']);
      return ready();
    }
    assert.equal(payload.tools, undefined);
    assert.equal(payload.messages.some(message => message.role === 'tool' || message.tool_calls), false);
    assert.match(payload.messages[0].content, /MarineGen 是海洋任务系统/);
    assert.match(payload.messages[0].content, /音频原型是音频特征的代表/);
    assert.doesNotMatch(payload.messages.map(message => message.content).join('\n'), /资料已足够/);
    return reply('MarineGen 是海洋任务系统；音频原型是音频特征的代表。');
  });
  const received = await collect(await flow.open());
  assert.equal(flow.payloads.length, 3);
  assert.equal(flow.searches(), 2);
  assert.match(received, /音频原型是音频特征的代表/);
  assert.equal(flow.closed(), true);
});

test('one batch query answers multiple questions with one search invocation', async t => {
  const flow = await setup(t, (payload, number, fileId) => {
    if (number === 1) return plan([call(fileId, ['MarineGen 定义', '音频原型定义'], 'batch')]);
    if (!payload.stream) {
      const result = JSON.parse(payload.messages.at(-1).content);
      assert.equal(result.queries.length, 2);
      assert.match(result.sources.map(source => source.text).join('\n'), /MarineGen 是海洋任务系统/);
      assert.match(result.sources.map(source => source.text).join('\n'), /音频原型是音频特征的代表/);
      return ready();
    }
    return reply('两个问题均有依据。');
  });
  await collect(await flow.open());
  assert.equal(flow.searches(), 1);
  assert.equal(flow.payloads.length, 3);
});

test('file metadata is provided once; search and supplemental read share numbered final evidence', async t => {
  const flow = await setup(t, (payload, number, fileId) => {
    assert.equal(payload.tools?.some(tool => ['ingestDocuments', 'listDocuments'].includes(tool.function.name)) ?? false, false);
    if (number === 1) return plan([call(fileId, ['MarineGen 定义'], 'search')]);
    if (number === 2) {
      const documents = JSON.parse(payload.messages[0].content.split('可用文件元数据：')[1]);
      assert.deepEqual(documents.map(document => document.id), [fileId]);
      const searched = JSON.parse(payload.messages.at(-1).content);
      assert.equal(payload.messages.at(-1).tool_call_id, 'search');
      assert.equal(searched.queries[0].query, 'MarineGen 定义');
      return plan([{ id: 'read', type: 'function', function: { name: 'readDocument',
        arguments: JSON.stringify({ fileId, startChunk: documents[0].chunkCount - 1, count: 2 }) } }]);
    }
    assert.match(payload.messages[0].content, /"name":"MarineGen.md"/);
    if (!payload.stream) {
      const result = JSON.parse(payload.messages.at(-1).content);
      assert.equal(payload.messages.at(-1).tool_call_id, 'read');
      assert.equal(result.queries, undefined);
      assert.equal(result.hasMore, false);
      assert.match(result.sources.map(source => source.text).join('\n'), /音频原型是音频特征的代表/);
      return ready();
    }
    assert.match(payload.messages[0].content, /MarineGen 是海洋任务系统/);
    assert.match(payload.messages[0].content, /音频原型是音频特征的代表/);
    return reply('检索后读取相邻原文，回答两个问题。');
  });
  const opened = await flow.open();
  assert.equal(new Set(opened.sources.map(source => `${source.fileId}:${source.chunkId}`)).size, opened.sources.length);
  assert.deepEqual(opened.sources.map(source => source.index), opened.sources.map((_, index) => index + 1));
  await collect(opened);
  assert.equal(flow.searches(), 1);
  assert.equal(flow.payloads.length, 4);
  assert.equal(flow.closed(), true);
});

test('supplemental retrieval uses JSON decisions and preserves numbered sources before streaming starts', async t => {
  let initialSources;
  const flow = await setup(t, (payload, number, fileId) => {
    if (number === 1) return plan([call(fileId, ['MarineGen 定义'], 'initial')]);
    if (number === 2) {
      assert.equal(payload.stream, false);
      initialSources = JSON.parse(payload.messages.at(-1).content).sources;
      return Response.json({ choices: [{ message: { role: 'assistant', content: null,
        reasoning_content: '需要补查第二个问题', tool_calls: [call(fileId, ['音频原型定义'], 'supplement')] } }] });
    }
    if (!payload.stream) {
      assert.equal(payload.messages.at(-2).reasoning_content, '需要补查第二个问题');
      assert.equal(payload.messages.at(-1).tool_call_id, 'supplement');
      assert.match(payload.messages.at(-1).content, /音频原型是音频特征的代表/);
      return ready();
    }
    assert.equal(payload.tools, undefined);
    return reply('两个问题的回答都有文件依据。');
  });
  const opened = await flow.open();
  for (const source of initialSources) assert.deepEqual(opened.sources.find(item => item.chunkId === source.chunkId), source);
  assert.match(opened.sources.map(source => source.text).join('\n'), /音频原型是音频特征的代表/);
  assert.equal(flow.closed(), true);
  const received = await collect(opened);
  assert.equal(flow.payloads.length, 4);
  assert.equal(flow.searches(), 2);
  assert.doesNotMatch(received, /EMPTY_AI_REPLY|tool_calls|tool_call_id/);
  assert.equal(received.match(/\[DONE\]/g).length, 1);
  assert.equal(flow.closed(), true);
});

test('after the configured retrieval limit, the model receives evidence in a tools-free final answer request', async t => {
  const flow = await setup(t, (payload, number, fileId) => {
    if (number === 1) return plan([call(fileId, ['MarineGen 定义'], 'initial')]);
    if (number === 2) return plan([call(fileId, ['音频原型定义'], 'audio')]);
    assert.equal(payload.stream, true);
    assert.equal(payload.tools, undefined);
    assert.equal(payload.messages.some(message => message.role === 'tool' || message.tool_calls), false);
    assert.match(payload.messages[0].content, /MarineGen 是海洋任务系统/);
    assert.match(payload.messages[0].content, /音频原型是音频特征的代表/);
    return reply('使用已有资料完成回答。');
  }, { documentMaxSearchRounds: 2 });
  await collect(await flow.open());
  assert.equal(flow.searches(), 2);
  assert.equal(flow.payloads.length, 3);
  assert.equal(flow.closed(), true);
});

test('repeated queries remain bounded by the planning limit and keep sources deduplicated', async t => {
  const flow = await setup(t, (payload, number, fileId) => {
    if (!payload.stream) return plan([call(fileId, ['MarineGen 定义'], `call-${number}`)]);
    assert.equal(payload.tools, undefined);
    assert.match(payload.messages[0].content, /MarineGen 是海洋任务系统/);
    return reply('根据已检索的原文回答。');
  }, { documentMaxSearchRounds: 3 });
  const opened = await flow.open();
  assert.equal(new Set(opened.sources.map(source => source.chunkId)).size, opened.sources.length);
  await collect(opened);
  assert.equal(flow.searches(), 3);
  assert.equal(flow.payloads.length, 4);
  assert.equal(flow.closed(), true);
});

test('oversized tool history ends planning while the smaller final evidence request still succeeds', async t => {
  const flow = await setup(t, (payload, number, fileId) => {
    if (number === 1) return Response.json({ choices: [{ message: {
      role: 'assistant', content: null, reasoning_content: 'checking'.repeat(2000),
      tool_calls: [call(fileId, ['MarineGen 定义'], 'initial')]
    } }] });
    assert.equal(payload.stream, true);
    assert.equal(payload.tools, undefined);
    assert.match(payload.messages[0].content, /MarineGen 是海洋任务系统/);
    return reply('使用预算内的原文完成回答。');
  }, { inputBudget: 6000, documentContextBudget: 3000 });
  await collect(await flow.open());
  assert.equal(flow.searches(), 1);
  assert.equal(flow.payloads.length, 2);
  assert.equal(flow.closed(), true);
});

test('aborting the model request after supplemental retrieval also closes its MCP session', async t => {
  const controller = new AbortController();
  let reached;
  const pendingRequest = new Promise(resolve => { reached = resolve; });
  const flow = await setup(t, (payload, number, fileId, signal) => {
    if (number === 1) return plan([call(fileId, ['MarineGen 定义'], 'initial')]);
    if (number === 2) return plan([call(fileId, ['音频原型定义'], 'audio')]);
    assert.equal(payload.stream, true);
    reached();
    return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
  }, { documentMaxSearchRounds: 2 });
  const opening = flow.open({ signal: controller.signal });
  await pendingRequest;
  controller.abort();
  await assert.rejects(opening, { name: 'AbortError' });
  assert.equal(flow.closed(), true);
});

test('cancelling a document tool preserves the abort reason and closes the MCP connection', { timeout: 5000 }, async () => {
  const config = createConfig({ ARK_API_KEY: 'fake', ARK_MODEL_ID: 'fake' });
  const controller = new AbortController();
  const fileId = randomUUID();
  let started;
  let toolSignal;
  let closed = false;
  const searching = new Promise(resolve => { started = resolve; });
  const documentService = {
    list: async () => [{ id: fileId, name: '说明.md', type: 'md', size: 10,
      createdAt: new Date().toISOString(), chunkCount: 1, status: 'ready' }],
    searchBatch: ({ signal }) => {
      toolSignal = signal;
      started();
      return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
    }
  };
  const service = createChatService({ config, documentService,
    arkClient: {
      createCompletion: async () => ({ choices: [{ message: { tool_calls: [call(fileId, ['内容'], 'search')] } }] }),
      createCompletionStream: async () => assert.fail('a cancelled search must not start an answer')
    },
    openMcp: async options => {
      const connection = await openDocumentMcp(options);
      connection.client.onclose = () => { closed = true; };
      return connection;
    }
  });
  const pending = service.openStream([{ role: 'user', content: '文件内容是什么？' }], {
    fileIds: [fileId], scopeId: randomUUID(), signal: controller.signal
  });
  await searching;
  controller.abort();
  await assert.rejects(pending, error => error === controller.signal.reason);
  assert.equal(toolSignal.aborted, true);
  assert.equal(closed, true);
});
