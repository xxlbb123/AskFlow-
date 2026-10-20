const { HttpError } = require('./http-error');

// 校验的是 SSE 事件中的回复正文；HTTP 200 和 [DONE] 都不能单独证明生成成功。
async function* guardChatStream(body, { signal } = {}) {
  const reader = body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const encoder = new TextEncoder();
  let buffer = '';
  let hasText = false;
  let finished = false;
  let finishReason = null;
  let contentChars = 0;
  let reasoningChars = 0;

  const fail = (code, message) => {
    const error = new HttpError(502, message, code);
    // 只记录结束原因与长度，避免把聊天、原文件或思考正文写入日志。
    console.warn('AI 流式回复异常:', JSON.stringify({ code, finishReason, contentChars, reasoningChars }));
    throw error;
  };
  const inspect = line => {
    if (!line.startsWith('data:')) return line;
    const data = line.slice(5).trim();
    if (!data) return line;
    if (data === '[DONE]') {
      if (finishReason === 'length') fail('AI_OUTPUT_TRUNCATED', hasText
        ? 'AI 回复达到输出长度上限，已保留收到的内容，可继续提问'
        : '模型输出达到长度上限，但没有生成回复正文，请重试');
      if (finishReason === 'content_filter') fail('AI_CONTENT_FILTERED', '模型限制了本次回复，请调整问题后重试');
      if (finishReason === 'tool_calls') fail('AI_UNEXPECTED_TOOL_CALL', '模型在回答阶段仍请求调用工具，请重试');
      if (!hasText) fail('EMPTY_AI_REPLY', 'AI 本次没有返回回复正文，请重试');
      finished = true;
      return line;
    }
    let event;
    try { event = JSON.parse(data); }
    catch { fail('UPSTREAM_INVALID_RESPONSE', 'AI 服务返回了无效的流式数据，请重试'); }
    if (event.error) throw new HttpError(502, typeof event.error === 'string' ? event.error : event.error.message || 'AI 服务返回错误', event.error.code || 'UPSTREAM_ERROR');
    const choice = event.choices?.[0];
    if (typeof choice?.delta?.content === 'string') {
      contentChars += choice.delta.content.length;
      if (choice.delta.content.trim()) hasText = true;
    }
    if (typeof choice?.delta?.reasoning_content === 'string') {
      reasoningChars += choice.delta.reasoning_content.length;
    }
    if (typeof choice?.finish_reason === 'string') finishReason = choice.finish_reason;
    if (choice?.delta?.tool_calls !== undefined) {
      fail('AI_UNEXPECTED_TOOL_CALL', '模型在回答阶段仍请求调用工具，请重试');
    }
    return line;
  };

  try {
    while (!finished) {
      const { done, value } = await reader.read();
      signal?.throwIfAborted();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      let newline;
      while ((newline = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newline + 1);
        buffer = buffer.slice(newline + 1);
        const output = inspect(line);
        yield encoder.encode(output);
        if (finished) {
          // DONE 的空行可能位于下一个网络分块；补齐事件后立即取消读取。
          yield encoder.encode(line.endsWith('\r\n') ? '\r\n' : '\n');
          return;
        }
      }
      if (done) {
        if (!finished && buffer) {
          const output = inspect(buffer);
          yield encoder.encode(output);
        }
        break;
      }
    }
    if (!finished) fail('UPSTREAM_INCOMPLETE_RESPONSE', 'AI 回复连接提前结束，已收到的内容仍保留，请重试');
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

module.exports = { guardChatStream };
