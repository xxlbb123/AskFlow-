const { HttpError } = require('../utils/http-error');

const TOP_K = 4;
// 以 UTF-8 字节数作保守预算估算；不是模型精确的 tokenizer。
const estimateSize = value => Buffer.byteLength(typeof value === 'string' ? value : JSON.stringify(value), 'utf8');
const invalidVector = () => new HttpError(409, '文档向量缺失或不兼容，请重新上传文件', 'DOCUMENT_REINDEX_REQUIRED');

function normalizeVector(vector) {
  if (!Array.isArray(vector) || !vector.length || !vector.every(Number.isFinite)) throw invalidVector();
  // 先缩放再计算长度，避免很大或很小的数值造成溢出或下溢。
  const scale = vector.reduce((largest, value) => Math.max(largest, Math.abs(value)), 0);
  if (!scale) throw invalidVector();
  const scaled = vector.map(value => value / scale);
  const length = Math.sqrt(scaled.reduce((total, value) => total + value * value, 0));
  return scaled.map(value => value / length);
}

function similarity(left, right) {
  if (left.length !== right.length) throw invalidVector();
  const score = left.reduce((total, value, index) => total + value * right[index], 0);
  return Math.max(-1, Math.min(1, score));
}

function cosineSimilarity(left, right) {
  return similarity(normalizeVector(left), normalizeVector(right));
}

function retrieveBatch(document, queries, budget, queryEmbeddings) {
  if (!Array.isArray(queryEmbeddings) || queryEmbeddings.length !== queries.length) throw invalidVector();
  const vectors = document.chunks.map(chunk => normalizeVector(chunk.embedding));
  const all = document.chunks.map((chunk, index) => toSource(document, chunk, index + 1));
  const plans = queries.map((query, queryIndex) => {
    const vector = normalizeVector(queryEmbeddings[queryIndex]);
    const candidates = vectors.map((chunk, index) => ({ index, score: similarity(vector, chunk) }))
      .filter(item => item.score > 0).sort((a, b) => b.score - a.score || a.index - b.index)
      .slice(0, TOP_K).map(item => item.index);
    return { query, candidates, indices: [], cursor: 0 };
  });
  const selected = [];
  const selectedIds = new Map();
  // 每个子问题轮流选一块；重复来源共享编号，也共享本次检索预算。
  while (plans.some(plan => plan.cursor < plan.candidates.length)) {
    for (const plan of plans) {
      if (plan.cursor >= plan.candidates.length) continue;
      const source = all[plan.candidates[plan.cursor++]];
      const existingIndex = selectedIds.get(source.chunkId);
      if (existingIndex) {
        plan.indices.push(existingIndex);
        continue;
      }
      const next = { ...source, index: selected.length + 1 };
      if (estimateSize([...selected, next]) > budget) continue;
      selected.push(next);
      selectedIds.set(source.chunkId, next.index);
      plan.indices.push(next.index);
    }
  }
  return { mode: all.length && selected.length === all.length ? 'full' : 'retrieval', sources: selected,
    queries: plans.map(plan => ({ query: plan.query,
      status: plan.indices.length ? 'matched' : plan.candidates.length ? 'budget_limited' : 'no_match', indices: plan.indices })) };
}

const toSource = (document, chunk, index) => ({ index, fileId: document.id, name: document.name,
  chunkId: chunk.id, section: chunk.section, startLine: chunk.startLine, endLine: chunk.endLine, text: chunk.content });

module.exports = { retrieveBatch, estimateSize, toSource, cosineSimilarity };
