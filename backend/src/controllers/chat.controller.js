const { once } = require('node:events');
const { HttpError } = require('../utils/http-error');
const { isId } = require('../services/document.service');

function readMessages(req) {
  if (!req.is('application/json')) {
    throw new HttpError(415, '聊天请求需要使用 application/json', 'UNSUPPORTED_MEDIA_TYPE');
  }
  const messages = req.body?.messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new HttpError(400, 'messages 必须是非空数组', 'INVALID_MESSAGES');
  }
  const roles = new Set(['system', 'user', 'assistant']);
  if (messages.some(message => !message || !roles.has(message.role) || typeof message.content !== 'string')) {
    throw new HttpError(400, '每条消息需要有效的 role 和字符串 content', 'INVALID_MESSAGES');
  }
  if (!messages.some(message => message.role === 'user' && message.content.trim())) {
    throw new HttpError(400, '至少需要一条非空的用户消息', 'INVALID_MESSAGES');
  }
  return messages.map(({ role, content }) => ({ role, content }));
}

function createChatController({ config, chatService }) {
  return async function sendMessage(req, res) {
    const messages = readMessages(req);
    const fileIds = req.body.fileIds ?? [];
    if (!Array.isArray(fileIds) || fileIds.length > 1 || fileIds.some(id => !isId(id))) {
      throw new HttpError(400, '当前每个会话支持一个有效的文件附件', 'INVALID_FILE_IDS');
    }
    const scopeId = req.body.scopeId;
    if (fileIds.length && !isId(scopeId)) throw new HttpError(400, '缺少有效的会话附件标识', 'INVALID_DOCUMENT_SCOPE');
    const controller = new AbortController(); //浏览器连接中断或者聊天请求超时时，取消后续模型请求和工具操作
    const onClose = () => {
      if (!res.writableFinished) {
        controller.abort(new DOMException('客户端已断开连接', 'AbortError'));
      }
    };
    res.once('close', onClose);
    const timer = setTimeout(() => {
      controller.abort(new HttpError(504, 'AI 服务请求超时，请稍后重试', 'UPSTREAM_TIMEOUT'));
    }, config.requestTimeoutMs);
    timer.unref();

    try {
      // 先确认上游成功，再发送 SSE 响应头，避免把 HTTP 错误伪装成成功的流。
      const { body, sources, documentMode } = await chatService.openStream(messages, {
        signal: controller.signal, fileIds, scopeId
      });
      controller.signal.throwIfAborted();
      res.status(200).set({
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no'
      });
      res.flushHeaders();
      if (sources) {
        res.write(`data: ${JSON.stringify({ type: 'sources', sources, mode: documentMode })}\n\n`);
        res.write(`data: ${JSON.stringify({ type: 'status', message: '正在生成回复…' })}\n\n`);
      }

      // 按字节转发，不在网络分块边界解码，中文和 SSE 半行仍由前端正确拼接。
      for await (const chunk of body) {
        controller.signal.throwIfAborted();
        if (!res.write(Buffer.from(chunk))) {
          await once(res, 'drain', { signal: controller.signal });
        }
      }
      res.end();
    } catch (error) {
      if (controller.signal.aborted) {
        if (controller.signal.reason?.name === 'AbortError' && res.destroyed) return;
        throw controller.signal.reason;
      }
      if (error instanceof HttpError) throw error;
      throw new HttpError(502, 'AI 回复连接中断，请稍后重试', 'UPSTREAM_STREAM_ERROR');
    } finally {
      clearTimeout(timer);
      res.off('close', onClose);
      controller.abort();
    }
  };
}

module.exports = { createChatController };
