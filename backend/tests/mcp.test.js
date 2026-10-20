const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { createConfig } = require('../src/config/env');
const { createDocumentService } = require('../src/services/document.service');
const { openDocumentMcp } = require('../src/mcp/document.client');
const { mergeEvidence } = require('../src/documents/evidence');
const { retrieveBatch, estimateSize } = require('../src/documents/retrieve');
const { chunkText } = require('../src/documents/chunk');
const { fixtureEmbedding, createFakeEmbeddingClient } = require('./helpers/embedding');

const documentText = '# MarineGen\n\nMarineGen 的项目定义和用途。' + 'a'.repeat(1600) + '\n\n# 无关资料\n'
  + ('今天晴天，可以出去散步。'.repeat(60) + '\n\n').repeat(20)
  + '# 音频原型\n\n音频原型的定义是音频特征的代表。' + 'b'.repeat(1600) + '\n\n# 训练方式\n\n训练方式采用弱配对数据。';

test('batch retrieval covers separate concepts, deduplicates sources and shares one total budget', () => {
  const document = { id: randomUUID(), name: '说明.md', chunks: chunkText(documentText).map(chunk => ({ ...chunk,
    embedding: fixtureEmbedding(`${chunk.section}\n${chunk.content}`, { role: 'corpus' }) })) };
  const queries = ['MarineGen 定义', '音频原型定义'];
  const result = retrieveBatch(document, queries, 6000, queries.map(query => fixtureEmbedding(query)));
  assert.equal(result.mode, 'retrieval');
  assert.equal(result.queries.length, 2);
  assert.ok(result.queries.every(query => query.status === 'matched'));
  assert.match(result.sources.map(source => source.text).join('\n'), /MarineGen 的项目定义/);
  assert.match(result.sources.map(source => source.text).join('\n'), /音频原型的定义是/);
  assert.ok(estimateSize(result.sources) <= 6000);
  assert.equal(new Set(result.sources.map(source => source.chunkId)).size, result.sources.length);
  const collected = result.sources.map(source => ({ ...source }));
  const laterQueries = ['训练方式', '音频原型定义'];
  const later = mergeEvidence(retrieveBatch(document, laterQueries, 6000,
    laterQueries.map(query => fixtureEmbedding(query))), collected, 6000);
  for (const source of result.sources) assert.deepEqual(collected.find(item => item.chunkId === source.chunkId), source);
  assert.ok(estimateSize(collected) <= 6000);
  assert.ok(later.sources.every(source => collected.some(item => item.index === source.index)));
  assert.equal(retrieveBatch(document, ['不存在的火箭参数'], 6000,
    [fixtureEmbedding('不存在的火箭参数')]).queries[0].status, 'no_match');
  assert.ok(result.sources.every(source => source.embedding === undefined));
});

test('real MCP discovery exposes four typed tools; independent calls enforce scope and schemas', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'yuan-chat-mcp-'));
  const config = { ...createConfig({ ARK_API_KEY: 'fake', ARK_MODEL_ID: 'fake' }), documentStorageDir: directory, documentContextBudget: 6000 };
  const documents = createDocumentService({ config,
    embeddingClient: createFakeEmbeddingClient({ dimensions: config.embeddingDimensions }) });
  const scopeId = randomUUID();
  const file = await documents.save({ name: '说明.md', scopeId, buffer: Buffer.from(documentText) });
  let searches = 0;
  const service = { ...documents, searchBatch: async args => { searches++; assert.equal(args.scopeId, scopeId); return documents.searchBatch(args); } };
  const { client, server } = await openDocumentMcp({ config, documentService: service, fileIds: [file.id], scopeId });
  t.after(async () => {
    await Promise.allSettled([client.close(), server.close()]);
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith('yuan-chat-mcp-'));
    await fs.rm(directory, { recursive: true, force: true });
  });
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map(tool => tool.name), ['searchDocuments', 'readDocument', 'listDocuments', 'ingestDocuments']);
  assert.ok(tools.every(tool => tool.inputSchema.type === 'object'));
  assert.deepEqual(tools[0].inputSchema.properties.fileId.enum, [file.id]);
  assert.equal(tools[0].inputSchema.properties.queries.maxItems, 8);
  assert.equal(tools[0].inputSchema.properties.scopeId, undefined);
  const search = args => client.callTool({ name: 'searchDocuments', arguments: args });
  for (const args of [{ fileId: randomUUID(), queries: ['内容'] }, { fileId: file.id, query: '旧参数' },
    { fileId: file.id, queries: ['  '] }, { fileId: file.id, queries: Array(9).fill('内容') },
    { fileId: file.id, queries: ['内容'], scopeId: randomUUID() }]) {
    const rejected = await search(args);
    assert.equal(rejected.isError, true);
    assert.match(rejected.content[0].text, /Input validation error/);
  }
  assert.equal(searches, 0);
  const result = (await search({ fileId: file.id, queries: ['MarineGen 定义', '音频原型定义'] })).structuredContent;
  assert.equal(searches, 1);
  assert.deepEqual(Object.keys(result).sort(), ['mode', 'queries', 'sources']);
  assert.equal(result.queries.length, 2);
  const repeated = (await search({ fileId: file.id, queries: ['MarineGen 定义', '音频原型定义'] })).structuredContent;
  assert.equal(searches, 2);
  assert.deepEqual(repeated, result);
  const wrongScope = await openDocumentMcp({ config, documentService: documents, fileIds: [file.id], scopeId: randomUUID() });
  try {
    const error = await wrongScope.client.callTool({ name: 'searchDocuments', arguments: { fileId: file.id, queries: ['内容'] } });
    assert.equal(error.isError, true);
    assert.equal(error.structuredContent.error.code, 'FILE_NOT_FOUND');
    assert.deepEqual(JSON.parse(error.content[0].text), error.structuredContent);
  }
  finally { await Promise.allSettled([wrongScope.client.close(), wrongScope.server.close()]); }
  const noFiles = await openDocumentMcp({ config, documentService: documents, fileIds: [], scopeId });
  try {
    const listed = await noFiles.client.callTool({ name: 'listDocuments', arguments: {} });
    assert.deepEqual(listed.structuredContent.documents, []);
    const searched = await noFiles.client.callTool({ name: 'searchDocuments', arguments: { fileId: file.id, queries: ['内容'] } });
    assert.equal(searched.isError, true);
    const read = await noFiles.client.callTool({ name: 'readDocument', arguments: { fileId: file.id } });
    assert.equal(read.isError, true);
  } finally { await Promise.allSettled([noFiles.client.close(), noFiles.server.close()]); }
});

test('cancelling one MCP call reaches its service without cancelling another call on the same connection', async () => {
  const config = createConfig({ ARK_API_KEY: 'fake', ARK_MODEL_ID: 'fake' });
  const controller = new AbortController();
  let observed;
  let toolSignal;
  const called = new Promise(resolve => { observed = resolve; });
  const fileId = randomUUID();
  const { client, server } = await openDocumentMcp({ config, fileIds: [fileId], scopeId: randomUUID(),
    documentService: { searchBatch: async ({ signal, queries }) => {
      if (queries[0] === '正常检索') {
        assert.equal(signal.aborted, false);
        return { mode: 'retrieval', sources: [], queries: [{ query: queries[0], status: 'no_match', indices: [] }] };
      }
      toolSignal = signal;
      observed();
      return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
    } } });
  try {
    const pending = client.callTool({ name: 'searchDocuments', arguments: { fileId, queries: ['检索'] } }, { signal: controller.signal });
    await called;
    controller.abort();
    // SDK 会包装取消异常；服务端收到取消、连接仍可使用才是这里要验证的行为。
    await assert.rejects(pending, error => error.message.includes(controller.signal.reason.message));
    await new Promise(resolve => toolSignal.aborted ? resolve() : toolSignal.addEventListener('abort', resolve, { once: true }));
    assert.equal(toolSignal.aborted, true);
    const healthy = await client.callTool({ name: 'searchDocuments', arguments: { fileId, queries: ['正常检索'] } });
    assert.equal(healthy.structuredContent.queries[0].status, 'no_match');
  } finally { await Promise.allSettled([client.close(), server.close()]); }
});

test('programmatic MCP ingestion preserves bytes; list and bounded reads only access authorized documents', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'yuan-chat-mcp-'));
  const config = { ...createConfig({ ARK_API_KEY: 'fake', ARK_MODEL_ID: 'fake' }), documentStorageDir: directory };
  const documentService = createDocumentService({ config,
    embeddingClient: createFakeEmbeddingClient({ dimensions: config.embeddingDimensions }) });
  const scopeId = randomUUID();
  const { client, server } = await openDocumentMcp({ config, documentService, scopeId });
  t.after(async () => {
    await Promise.allSettled([client.close(), server.close()]);
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith('yuan-chat-mcp-'));
    await fs.rm(directory, { recursive: true, force: true });
  });
  const bytes = Buffer.from('\ufeff# 使用说明\r\n\r\n' + '设备说明'.repeat(500));
  const result = await client.callTool({ name: 'ingestDocuments', arguments: {
    documents: [{ name: '设备.md', dataBase64: bytes.toString('base64') }]
  } });
  assert.deepEqual(JSON.parse(result.content[0].text), result.structuredContent);
  const file = result.structuredContent.documents[0];
  assert.deepEqual(await fs.readFile(path.join(directory, file.id, 'original.md')), bytes);
  await documentService.save({ name: '其他会话.txt', scopeId: randomUUID(), buffer: Buffer.from('其他会话资料') });
  const documents = (await client.callTool({ name: 'listDocuments', arguments: {} })).structuredContent.documents;
  assert.deepEqual(documents.map(document => document.id), [file.id]);
  const first = (await client.callTool({ name: 'readDocument', arguments: { fileId: file.id, startChunk: 1, count: 1 } })).structuredContent;
  assert.equal(first.mode, 'retrieval');
  assert.equal(first.hasMore, true);
  assert.equal(first.nextChunk, 2);
  assert.equal(first.sources[0].chunkId, 'chunk-1');
  const second = (await client.callTool({ name: 'readDocument', arguments: { fileId: file.id, startChunk: 2, count: 1 } })).structuredContent;
  assert.equal(second.sources[0].chunkId, 'chunk-2');
  const all = (await client.callTool({ name: 'readDocument', arguments: { fileId: file.id, count: 6 } })).structuredContent;
  assert.equal(all.mode, 'full');
  assert.equal(all.hasMore, false);
  const invalid = await client.callTool({ name: 'readDocument', arguments: { fileId: file.id, startChunk: 999 } });
  assert.equal(invalid.isError, true);
  assert.equal(invalid.structuredContent.error.code, 'INVALID_CHUNK_RANGE');
});

test('evidence accumulation keeps stable IDs across files and downgrades full mode when the total budget is exhausted', () => {
  const source = { index: 1, fileId: 'first-file', chunkId: 'chunk-1', name: 'a.md',
    section: '正文', startLine: 1, endLine: 1, text: '原文一' };
  const sources = [];
  const first = { mode: 'full', sources: [source], queries: [{ query: '问题一', status: 'matched', indices: [1] }] };
  assert.equal(mergeEvidence(first, sources, 1000).mode, 'full');
  const other = { ...source, fileId: 'second-file', text: '原文二' };
  const accepted = mergeEvidence({ ...first, sources: [other] }, sources, 1000);
  assert.equal(accepted.sources[0].index, 2);
  assert.deepEqual(accepted.queries[0].indices, [2]);
  const fullBudget = estimateSize(sources);
  const exhausted = mergeEvidence({ ...first, sources: [{ ...source, chunkId: 'chunk-2' }] }, sources, fullBudget);
  assert.equal(exhausted.mode, 'retrieval');
  assert.deepEqual(exhausted.sources, []);
  assert.equal(exhausted.queries[0].status, 'budget_limited');
  assert.equal(mergeEvidence(first, sources, fullBudget).sources[0].index, 1);
  assert.equal(sources.length, 2);
});
