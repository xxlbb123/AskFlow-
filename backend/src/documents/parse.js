const path = require('node:path');
const { HttpError } = require('../utils/http-error');

// 将上传的文件字节转成可切分的文本；不负责会话权限和磁盘存储。
function parseTextFile({ name, buffer, maxBytes }) {
  if (typeof name !== 'string' || name.length > 200 || /[\\/\x00-\x1f]/.test(name)) {
    throw new HttpError(400, '文件名无效', 'INVALID_FILENAME');
  }
  const type = path.extname(name).slice(1).toLowerCase();
  if (!['txt', 'md'].includes(type)) {
    throw new HttpError(415, '目前支持 TXT、MD 文本文件', 'UNSUPPORTED_FILE_TYPE');
  }
  if (!Buffer.isBuffer(buffer) || !buffer.length) {
    throw new HttpError(400, '文件内容为空', 'EMPTY_FILE');
  }
  if (buffer.length > maxBytes) {
    throw new HttpError(413, '文件超过大小限制', 'FILE_TOO_LARGE');
  }

  let text;
  try {
    // fatal: true 让无效的 UTF-8 报错，避免静默替换为乱码字符。
    text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    throw new HttpError(400, '文件需要使用 UTF-8 编码，请转换编码后重试', 'INVALID_FILE_ENCODING');
  }
  if (text.includes('\0')) {
    throw new HttpError(400, '文件不是可读取的文本', 'INVALID_FILE_CONTENT');
  }
  if (!text.trim()) {
    throw new HttpError(400, '文件没有有效文字内容', 'EMPTY_FILE');
  }
  return { type, text };
}

module.exports = { parseTextFile };
