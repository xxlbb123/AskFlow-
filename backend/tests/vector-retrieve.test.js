const assert = require('node:assert/strict');
const test = require('node:test');
const { retrieveBatch, estimateSize, toSource, cosineSimilarity } = require('../src/documents/retrieve');

const documentWith = chunks => ({ id: 'file-1', name: '设备说明.md', chunks: chunks.map(([content, embedding], index) => ({
  id: `chunk-${index + 1}`, section: '说明', startLine: index + 1, endLine: index + 1, content, embedding
})) });

test('semantic similarity recalls different wording and omits embeddings from evidence', () => {
  const document = documentWith([
    ['出现故障码 E3 时，请先检查温度传感器。', [1, 0, 0]],
    ['烹饪程序选择说明。', [0, 1, 0]],
    ['包装清单。', [-1, 0, 0]],
    ['售后服务。', [0, 0, 1]],
    ['部件目录。', [0, -1, 0]]
  ]);
  const result = retrieveBatch(document, ['报错如何排除？'], 12000, [[1, 0, 0]]);
  assert.equal(result.mode, 'retrieval');
  assert.deepEqual(result.sources.map(source => source.chunkId), ['chunk-1']);
  assert.match(result.sources[0].text, /温度传感器/);
  assert.deepEqual(result.queries[0], { query: '报错如何排除？', status: 'matched', indices: [1] });
  assert.equal(result.sources[0].embedding, undefined);
});

test('each query keeps the four most similar chunks, ordered by cosine similarity', () => {
  const document = documentWith(Array.from({ length: 6 }, (_, index) => [`段落 ${index + 1}`, [1, index]]));
  const result = retrieveBatch(document, ['问题'], 12000, [[1, 0]]);
  assert.equal(result.mode, 'retrieval');
  assert.deepEqual(result.sources.map(source => source.chunkId), ['chunk-1', 'chunk-2', 'chunk-3', 'chunk-4']);
});

test('queries share deduplicated sources and stable indices', () => {
  const document = documentWith([['共同依据', [1, 0]], ['其他依据', [-1, 0]]]);
  const result = retrieveBatch(document, ['含义', '处理'], 12000, [[1, 0], [1, 0]]);
  assert.equal(result.sources.length, 1);
  assert.deepEqual(result.queries.map(query => query.indices), [[1], [1]]);
});

test('queries take turns under one budget and report candidates that cannot fit', () => {
  const document = documentWith([['故障含义', [1, 0]], ['处理步骤', [0, 1]], ['后续建议', [-1, 0]]]);
  const budget = estimateSize([toSource(document, document.chunks[0], 1)]);
  const result = retrieveBatch(document, ['含义', '处理'], budget, [[1, 0], [0, 1]]);
  assert.equal(result.sources.length, 1);
  assert.ok(estimateSize(result.sources) <= budget);
  assert.deepEqual(result.queries.map(query => query.status), ['matched', 'budget_limited']);
  assert.deepEqual(result.queries[1].indices, []);
});

test('round-robin selection leaves room for a second question before more first-question evidence', () => {
  const document = documentWith([
    ['故障含义', [1, 0]], ['补充含义', [1, -0.1]], ['处理步骤', [0, 1]], ['补充处理', [-0.1, 1]]
  ]);
  const budget = estimateSize([toSource(document, document.chunks[0], 1), toSource(document, document.chunks[2], 2)]);
  const result = retrieveBatch(document, ['含义', '处理'], budget, [[1, 0], [0, 1]]);
  assert.deepEqual(result.sources.map(source => source.chunkId), ['chunk-1', 'chunk-3']);
  assert.deepEqual(result.queries.map(query => query.indices), [[1], [2]]);
});

test('full mode requires all document chunks to be selected within the budget', () => {
  const document = documentWith([['含义', [1, 0]], ['处理', [0, 1]]]);
  const result = retrieveBatch(document, ['完整说明'], 12000, [[1, 1]]);
  assert.equal(result.mode, 'full');
  assert.equal(result.sources.length, 2);
  assert.deepEqual(result.queries[0].indices, [1, 2]);
  assert.equal(retrieveBatch(document, ['只问含义'], 12000, [[1, 0]]).mode, 'retrieval');
});

test('nonpositive similarities return no_match instead of arbitrary evidence', () => {
  const document = documentWith([['资料', [1, 0]], ['其他资料', [0, 1]]]);
  const result = retrieveBatch(document, ['不相关问题'], 12000, [[-1, 0]]);
  assert.deepEqual(result.sources, []);
  assert.deepEqual(result.queries[0], { query: '不相关问题', status: 'no_match', indices: [] });
});

test('missing, nonfinite, zero, and incompatible vectors explicitly require a new index', () => {
  for (const vector of [undefined, [], [0, 0], [NaN, 1], [Infinity, 1], ['1', 0], [1, 0, 0]]) {
    const document = documentWith([['资料', vector]]);
    assert.throws(() => retrieveBatch(document, ['问题'], 12000, [[1, 0]]), error => {
      assert.equal(error.status, 409);
      assert.equal(error.code, 'DOCUMENT_REINDEX_REQUIRED');
      assert.match(error.message, /重新上传/);
      return true;
    });
  }
  const document = documentWith([['资料', [1, 0]]]);
  assert.throws(() => retrieveBatch(document, ['问题'], 12000), { code: 'DOCUMENT_REINDEX_REQUIRED' });
  assert.throws(() => retrieveBatch(document, ['问题'], 12000, []), { code: 'DOCUMENT_REINDEX_REQUIRED' });
  assert.throws(() => retrieveBatch(document, ['问题'], 12000, [[0, 0]]), { code: 'DOCUMENT_REINDEX_REQUIRED' });
});

test('cosine similarity handles vector scale and large or small finite values', () => {
  assert.equal(cosineSimilarity([1, 0], [5, 0]), 1);
  assert.equal(cosineSimilarity([1, 0], [-1, 0]), -1);
  assert.equal(cosineSimilarity([1, 0], [0, 1]), 0);
  assert.ok(Math.abs(cosineSimilarity([1e308, 1e308], [1e-300, 1e-300]) - 1) < 1e-12);
});
