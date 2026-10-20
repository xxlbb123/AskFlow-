const { HttpError } = require('../utils/http-error');

function notFoundHandler(req, res, next) {
  next(new HttpError(404, '接口不存在', 'NOT_FOUND'));
}

function errorHandler(error, req, res, next) {
  if (res.destroyed || res.writableEnded) return;

  let status = 500;
  let code = 'INTERNAL_ERROR';
  let message = '服务器处理请求失败';
  if (error instanceof HttpError) {
    ({ status, code, message } = error);
  } else if (error.type === 'entity.parse.failed') {
    status = 400;
    code = 'INVALID_JSON';
    message = '请求体不是有效的 JSON';
  } else if (error.type === 'entity.too.large') {
    status = 413;
    code = 'PAYLOAD_TOO_LARGE';
    message = req.path.startsWith('/api/files') ? '文件超过大小限制，请缩小文件后重试' : '请求内容过大，请缩短聊天内容';
  }
  const payload = { error: { code, message } };

  if (res.headersSent) {
    if (String(res.getHeader('Content-Type')).includes('text/event-stream')) {
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
      res.end('data: [DONE]\n\n');
      return;
    }
    return next(error);
  }
  res.status(status).json(payload);
}

module.exports = { errorHandler, notFoundHandler };
