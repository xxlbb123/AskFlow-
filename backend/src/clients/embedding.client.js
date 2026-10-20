const { HttpError } = require('../utils/http-error');

// 修改检索指令时同步修改版本，防止新问题向量与旧文档向量混用。
const embeddingProfile = 'doubao-text-retrieval-v1';
const instructions = {
  corpus: 'Instruction:Compress the text into one word.\nQuery:',
  query: 'Target_modality: text.\nInstruction:根据这个问题，检索能够回答问题的相关文档片段。\nQuery:'
};

function createEmbeddingClient({ config, fetchImpl = globalThis.fetch }) {
  async function embed(text, { role = 'query', signal } = {}) {
    if (typeof text !== 'string' || !text.trim()) throw new TypeError('向量化文本不能为空');
    if (!Object.hasOwn(instructions, role)) throw new TypeError('向量角色必须是 corpus 或 query');
    signal?.throwIfAborted();
    //  文件操作超时或客户端断开时，取消正在进行的 MCP 文件处理
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(
      new HttpError(504, '向量服务请求超时，请稍后重试', 'EMBEDDING_TIMEOUT')
    ), config.requestTimeoutMs);
    const requestSignal = signal ? AbortSignal.any([signal, timeout.signal]) : timeout.signal;

    try {
      let response;
      try {
        response = await fetchImpl(`${config.arkBaseUrl}/embeddings/multimodal`, {
          method: 'POST',
          signal: requestSignal,
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${config.apiKey}`
          },
          body: JSON.stringify({
            model: config.embeddingModelId,
            dimensions: config.embeddingDimensions,
            encoding_format: 'float',
            instructions: instructions[role],
            // 多模态 input 数组会合成一个向量，不能把多个文档块放进同一次请求。
            input: [{ type: 'text', text }]
          })
        });
      } catch {
        requestSignal.throwIfAborted();
        throw new HttpError(502, '无法连接向量服务，请稍后重试', 'EMBEDDING_UNAVAILABLE');
      }
      requestSignal.throwIfAborted();
      if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        requestSignal.throwIfAborted();
        throw new HttpError(502, `向量服务请求失败（HTTP ${response.status}），请检查模型配置及服务状态`, 'EMBEDDING_UPSTREAM_ERROR');
      }

      let result;
      try {
        result = await response.json();
      } catch {
        requestSignal.throwIfAborted();
        throw new HttpError(502, '向量服务没有返回有效的 JSON 响应', 'EMBEDDING_INVALID_RESPONSE');
      }
      requestSignal.throwIfAborted();
      if (result?.error) {
        throw new HttpError(502, '向量服务返回错误，请检查模型配置及服务状态', 'EMBEDDING_UPSTREAM_ERROR');
      }

      const vector = result?.data?.embedding;
      if (!Array.isArray(vector) || vector.length !== config.embeddingDimensions
        || !vector.every(Number.isFinite) || !vector.some(value => value !== 0)) {
        throw new HttpError(502, '向量服务返回的向量无效或维度不匹配', 'EMBEDDING_INVALID_RESPONSE');
      }
      return vector;
    } finally {
      clearTimeout(timer);
    }
  }

  return { embed };
}

module.exports = { createEmbeddingClient, embeddingProfile };
