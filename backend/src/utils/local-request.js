const localHosts = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
const localAddresses = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

const localOnlyMessage = '微信整理仅支持本机网页或本机客户端';

function isLocalRequest(req) {
  if (!localAddresses.has(req.socket.remoteAddress) || !localHosts.has(req.hostname)) return false;
  const origin = req.get('Origin');
  if (!origin) return true;
  try {
    const url = new URL(origin);
    return ['http:', 'https:'].includes(url.protocol) && localHosts.has(url.hostname);
  } catch {
    return false;
  }
}

module.exports = { isLocalRequest, localOnlyMessage };
