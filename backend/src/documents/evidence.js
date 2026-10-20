const { estimateSize } = require('./retrieve');

// 本次问答统一累积依据、分配引用编号；MCP 工具无需保存聊天状态。
function mergeEvidence(result, sources, budget) {
  const indices = new Map();
  const included = [];
  for (const source of result.sources) {
    let saved = sources.find(item => item.fileId === source.fileId && item.chunkId === source.chunkId);
    if (!saved) {
      const next = { ...source, index: sources.length + 1 };
      if (estimateSize([...sources, next]) > budget) continue;
      sources.push(next);
      saved = next;
    }
    indices.set(source.index, saved.index);
    included.push(saved);
  }
  return { ...result, mode: result.mode === 'full' && included.length === result.sources.length ? 'full' : 'retrieval',
    sources: included,
    ...(result.queries ? { queries: result.queries.map(item => {
      const accepted = item.indices.map(index => indices.get(index)).filter(Boolean);
      return { ...item, indices: accepted,
        status: item.status === 'matched' && !accepted.length ? 'budget_limited' : item.status };
    }) } : {}) };
}

module.exports = { mergeEvidence };
