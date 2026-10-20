// Deterministic vectors keep document/MCP tests independent of external embedding APIs.
const concepts = [/marinegen|海洋任务/i, /音频原型/, /训练|弱配对/, /会话|草稿|保存/, /天气|晴天|散步/, /设备|e3/i];

function fixtureEmbedding(text, { role = 'query', dimensions = 1024 } = {}) {
  const vector = Array(dimensions).fill(0);
  vector[0] = role === 'query' && /不存在|火箭/.test(text) ? -1 : 1;
  if (vector[0] < 0) return vector;
  const matches = concepts.map(pattern => pattern.test(text));
  for (let index = 0; index < concepts.length && index + 1 < dimensions; index++) {
    // Queries favour their concepts and reject unrelated concepts; generic queries share the common component.
    vector[index + 1] = matches[index] ? 8 : role === 'query' && matches.some(Boolean) ? -1 : 0;
  }
  return vector;
}

function createFakeEmbeddingClient({ dimensions = 1024, onEmbed } = {}) {
  const calls = [];
  return {
    calls,
    async embed(text, { role = 'query', signal } = {}) {
      signal?.throwIfAborted();
      calls.push({ text, role });
      await onEmbed?.(text, { role, signal });
      signal?.throwIfAborted();
      return fixtureEmbedding(text, { role, dimensions });
    }
  };
}

module.exports = { fixtureEmbedding, createFakeEmbeddingClient };
