const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { HttpError } = require('../utils/http-error');
const { createEmbeddingClient, embeddingProfile } = require('../clients/embedding.client');
const { parseTextFile } = require('../documents/parse');
const { chunkText } = require('../documents/chunk');
const { retrieveBatch, estimateSize, toSource } = require('../documents/retrieve');

const isId = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
function checkScope(scopeId) {
  if (!isId(scopeId)) throw new HttpError(400, '无效的会话附件标识', 'INVALID_DOCUMENT_SCOPE');
}
const publicMetadata = document => ({ id: document.id, name: document.name, type: document.type,
  size: document.size, createdAt: document.createdAt, chunkCount: document.chunks.length, status: 'ready' });
// 定义了save等等一组方法  
function createDocumentService({ config, embeddingClient = createEmbeddingClient({ config }) }) {
  async function embedBatch(texts, role, signal) {
    const controller = new AbortController();
    const batchSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
    try {
      return await Promise.all(texts.map(text => embeddingClient.embed(text, { role, signal: batchSignal })));
    } catch (error) {
      // 一项失败时取消同批其他请求，保留原始错误，也不影响调用方的取消状态。
      controller.abort(error);
      throw error;
    }
  }
  async function save({ name, scopeId, buffer, signal }) {
    signal?.throwIfAborted();//检查取消状态和范围标识
    checkScope(scopeId); //检查范围标识
    // 这个函数用来检查文件名称,格式,大小和编码
    const { type, text } = parseTextFile({ name, buffer, maxBytes: config.fileMaxBytes });
    const chunks = chunkText(text);
    // 每批最多 4 个请求，全部向量生成成功后才保存附件。
    for (let start = 0; start < chunks.length; start += 4) {
      signal?.throwIfAborted();
      const batch = chunks.slice(start, start + 4);
      const embeddings = await embedBatch(
        batch.map(chunk => `${chunk.section}\n${chunk.content}`), 'corpus', signal);
      batch.forEach((chunk, index) => { chunk.embedding = embeddings[index]; });
    }
    // 构建要保存的文档
    const document = {
      version: 3,
      id: randomUUID(),
      scopeId,
      name,
      type,
      size: buffer.length,
      //记录文档切分方式
      chunking: { strategy: 'fixed', chunkSize: 900, overlap: 160 },
      embedding: { model: config.embeddingModelId, dimensions: config.embeddingDimensions, profile: embeddingProfile },
      createdAt: new Date().toISOString(),
      chunks //真正供后续检索读取使用的文本分块
    };
    // 用户文件名仅作为元数据；实际路径始终由服务端生成的 UUID 决定。
    const storageRoot = path.resolve(config.documentStorageDir);
    const directory = path.join(storageRoot, document.id);
    if (path.dirname(directory) !== storageRoot) throw new Error('无效的文件存储目录');
    await fs.mkdir(directory, { recursive: true });
    try {
      signal?.throwIfAborted();
      await fs.writeFile(path.join(directory, `original.${type}`), buffer);
      await fs.writeFile(path.join(directory, 'document.json'), JSON.stringify(document, null, 2), 'utf8');
      signal?.throwIfAborted();
    } catch (error) {
      await fs.rm(directory, { recursive: true, force: true });
      throw error;
    }
    return publicMetadata(document);
  }

  async function read(id, scopeId) {
    checkScope(scopeId);
    if (!isId(id)) throw new HttpError(400, '无效的文件标识', 'INVALID_FILE_ID');
    let document;
    try { document = JSON.parse(await fs.readFile(path.join(config.documentStorageDir, id, 'document.json'), 'utf8')); }
    catch (error) {
      if (error.code === 'ENOENT') throw new HttpError(404, '附件不存在，请重新上传', 'FILE_NOT_FOUND');
      throw error;
    }
    if (document.scopeId !== scopeId) throw new HttpError(404, '当前会话无法使用此附件', 'FILE_NOT_FOUND');
    return document;
  }
  async function searchBatch({ fileId, queries, scopeId, signal }) {
    signal?.throwIfAborted();
    const document = await read(fileId, scopeId);
    signal?.throwIfAborted();
    if (document.embedding?.model !== config.embeddingModelId
      || document.embedding.dimensions !== config.embeddingDimensions
      || document.embedding.profile !== embeddingProfile) {
      throw new HttpError(409, '附件的向量索引需要更新，请重新上传文件', 'DOCUMENT_REINDEX_REQUIRED');
    }
    const uniqueQueries = [...new Set(queries)];
    const queryEmbeddings = await embedBatch(uniqueQueries, 'query', signal);
    signal?.throwIfAborted();
    return retrieveBatch(document, uniqueQueries, config.documentContextBudget, queryEmbeddings);
  }
  async function list({ scopeId, fileIds, signal }) {
    checkScope(scopeId);
    let ids = fileIds;
    if (!ids) {
      try { ids = (await fs.readdir(config.documentStorageDir)).filter(isId); }
      catch (error) { if (error.code === 'ENOENT') return []; throw error; }
    }
    const documents = [];
    for (const id of ids) {
      signal?.throwIfAborted();
      try { documents.push(publicMetadata(await read(id, scopeId))); }
      catch (error) {
        // 指定的附件必须存在；枚举会话文档时跳过其他会话的附件。
        if (!fileIds && error.code === 'FILE_NOT_FOUND') continue;
        throw error;
      }
    }
    return documents.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  async function readChunks({ fileId, scopeId, startChunk = 1, count = 1, signal }) {
    signal?.throwIfAborted();
    const document = await read(fileId, scopeId);
    if (startChunk > document.chunks.length) 
      throw new HttpError(400, '起始分块超出文档范围', 'INVALID_CHUNK_RANGE');
    const sources = [];
    for (const chunk of document.chunks.slice(startChunk - 1, startChunk - 1 + count)) {
      signal?.throwIfAborted();
      const source = toSource(document, chunk, sources.length + 1);
      if (estimateSize([...sources, source]) > config.documentContextBudget) break;
      sources.push(source);
    }
    if (!sources.length) throw new HttpError(413, '该分块超过资料预算，请调整预算后重试', 'DOCUMENT_CONTEXT_TOO_SMALL');
    const nextChunk = startChunk + sources.length;
    const hasMore = nextChunk <= document.chunks.length;
    return { mode: startChunk === 1 && !hasMore ? 'full' : 'retrieval', sources, hasMore,
      ...(hasMore ? { nextChunk } : {}) };
  }
  return { save, read, searchBatch, list, readChunks };
}

module.exports = { createDocumentService, isId };
