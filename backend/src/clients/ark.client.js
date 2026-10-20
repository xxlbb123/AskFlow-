const { HttpError } = require('../utils/http-error');
const { guardChatStream } = require('../utils/chat-stream');

// 客户端只处理方舟的 HTTP 协议，不依赖 Express 的 req、res。
function createArkClient({ config, fetchImpl = globalThis.fetch }) {
  async function responseError(response, signal, fallbackCode = 'UPSTREAM_ERROR') {
    const payload = await response.json().catch(() => null);
    signal?.throwIfAborted();
    const detail = payload?.error;
    const message = typeof detail === 'string' ? detail : detail?.message;
    return new HttpError(
      response.status >= 400 ? response.status : 502,
      message || `AI 服务没有返回有效响应（HTTP ${response.status}）`,
      detail?.code || fallbackCode
    );
  }

  async function request(payload, { signal } = {}) {
    let response;
    try {
      response = await fetchImpl(`${config.arkBaseUrl}/chat/completions`, {
        method: 'POST',
        signal,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.apiKey}`
        },
        body: JSON.stringify(payload)
      });
    } catch {
      signal?.throwIfAborted();
      throw new HttpError(502, '无法连接 AI 服务，请稍后重试', 'UPSTREAM_UNAVAILABLE');
    }
    signal?.throwIfAborted();
    if (!response.ok) throw await responseError(response, signal);
    return response;
  }

  // 工具选择阶段可以使用普通 JSON 响应，之后仍复用同一个客户端。
  async function createCompletion(payload, options) {
    const response = await request({ ...payload, stream: false }, options);
    try {
      const result = await response.json();
      if (result?.error) {
        throw new HttpError(502, result.error.message || 'AI 服务返回错误', result.error.code || 'UPSTREAM_ERROR');
      }
      if (!Array.isArray(result?.choices) || result.choices.length === 0) {
        throw new HttpError(502, 'AI 服务没有返回有效的对话结果', 'UPSTREAM_INVALID_RESPONSE');
      }
      if (result.choices[0].finish_reason === 'length') {
        throw new HttpError(502, '模型的工具决策达到输出长度上限，请重试', 'AI_TOOL_DECISION_TRUNCATED');
      }
      return result;
    } catch (error) {
      options?.signal?.throwIfAborted();
      if (error instanceof HttpError) throw error;
      throw new HttpError(502, 'AI 服务没有返回有效的 JSON 响应', 'UPSTREAM_INVALID_RESPONSE');
    }
  }

  async function createCompletionStream(payload, options) {
    const response = await request({ ...payload, stream: true }, options);
    const contentType = response.headers.get('content-type') || '';
    if (!response.body || !contentType.toLowerCase().includes('text/event-stream')) {
      throw await responseError(response, options?.signal, 'UPSTREAM_INVALID_RESPONSE');
    }
    return guardChatStream(response.body, { signal: options?.signal });
  }

  return { createCompletion, createCompletionStream };
}

module.exports = { createArkClient };
