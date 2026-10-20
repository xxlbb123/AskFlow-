const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { Client } = require('@modelcontextprotocol/client');
const { StdioClientTransport } = require('@modelcontextprotocol/client/stdio');
const { createDocumentService } = require('../src/services/document.service');
const { createConfig } = require('../src/config/env');
const { createFakeEmbeddingClient } = require('./helpers/embedding');

const mockEmbeddingFetch = path.resolve(__dirname, 'helpers/mock-embedding-fetch.cjs');

test('an external MCP client discovers and calls the standalone stdio entrypoint', { timeout: 15000 }, async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'yuan-chat-mcp-stdio-'));
  const config = { ...createConfig({ ARK_API_KEY: 'fake', ARK_MODEL_ID: 'fake' }), documentStorageDir: directory };
  const scopeId = randomUUID();
  const file = await createDocumentService({ config,
    embeddingClient: createFakeEmbeddingClient({ dimensions: config.embeddingDimensions }) }).save({
    name: '规则.md', scopeId, buffer: Buffer.from('发送后保存会话，空白草稿不保存。') });
  const client = new Client({ name: 'external-test', version: '1.0.0' });
  t.after(async () => {
    await client.close();
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith('yuan-chat-mcp-stdio-'));
    await fs.rm(directory, { recursive: true, force: true });
  });
  await client.connect(new StdioClientTransport({ command: process.execPath,
    args: ['--require', mockEmbeddingFetch, path.resolve(__dirname, '../mcp.js'), '--scope-id', scopeId, '--file-id', file.id],
    env: { ...process.env, ARK_API_KEY: 'fake', ARK_MODEL_ID: 'fake', DOCUMENT_STORAGE_DIR: directory,
      ARK_EMBEDDING_MODEL_ID: config.embeddingModelId,
      ARK_EMBEDDING_DIMENSIONS: String(config.embeddingDimensions) }, stderr: 'pipe' }));
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map(tool => tool.name), ['searchDocuments', 'readDocument', 'listDocuments', 'ingestDocuments']);
  assert.ok(tools.every(tool => tool.inputSchema.type === 'object'));
  for (let index = 0; index < 4; index++) {
    const result = await client.callTool({ name: 'searchDocuments', arguments: { fileId: file.id, queries: ['保存条件', '空白草稿'] } });
    assert.equal(result.isError, undefined);
    assert.equal(result.structuredContent.mode, 'full');
    assert.match(result.structuredContent.sources[0].text, /空白草稿不保存/);
  }
});

test('the scoped stdio entrypoint imports, lists and reads a document without requiring a pre-existing file ID', { timeout: 15000 }, async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'yuan-chat-mcp-stdio-'));
  const config = createConfig({ ARK_API_KEY: 'fake', ARK_MODEL_ID: 'fake' });
  const scopeId = randomUUID();
  const client = new Client({ name: 'external-ingest-test', version: '1.0.0' });
  t.after(async () => {
    await client.close();
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith('yuan-chat-mcp-stdio-'));
    await fs.rm(directory, { recursive: true, force: true });
  });
  await client.connect(new StdioClientTransport({ command: process.execPath,
    args: ['--require', mockEmbeddingFetch, path.resolve(__dirname, '../mcp.js'), '--scope-id', scopeId],
    env: { ...process.env, ARK_API_KEY: 'fake', ARK_MODEL_ID: 'fake', DOCUMENT_STORAGE_DIR: directory,
      ARK_EMBEDDING_MODEL_ID: config.embeddingModelId,
      ARK_EMBEDDING_DIMENSIONS: String(config.embeddingDimensions) }, stderr: 'pipe' }));
  await client.listTools();
  const imported = await client.callTool({ name: 'ingestDocuments', arguments: {
    documents: [{ name: '说明.md', dataBase64: Buffer.from('# 使用说明\n文档原文。').toString('base64') }]
  } });
  assert.equal(imported.isError, undefined);
  const file = imported.structuredContent.documents[0];
  const listed = await client.callTool({ name: 'listDocuments', arguments: {} });
  assert.deepEqual(listed.structuredContent.documents.map(document => document.id), [file.id]);
  const read = await client.callTool({ name: 'readDocument', arguments: { fileId: file.id } });
  assert.equal(read.structuredContent.mode, 'full');
  assert.match(read.structuredContent.sources[0].text, /文档原文/);
});
