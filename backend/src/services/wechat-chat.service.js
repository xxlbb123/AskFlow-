const { planWechatAction } = require('./wechat-export.service');
const { requestWechatReport, saveWechatReport } = require('./wechat-reports.service');
const { localOnlyMessage } = require('../utils/local-request');
const { HttpError } = require('../utils/http-error');

const clarifyPrefix = '请补充微信整理条件。';
const mentionWechat = /微信|we\s*chat|weixin/i;
const event = data => `data: ${JSON.stringify(data)}\n\n`;
const replyDelta = content => event({ choices: [{ delta: { content } }] });
const done = 'data: [DONE]\n\n';

function collectWechatTurn(messages) {
  const latest = messages.at(-1);
  if (latest?.role !== 'user') return null;
  let first = messages.length - 1;
  // 只延续尚在追问的整理请求，已经完成的请求不会因普通追问被重新执行。
  while (first >= 2 && messages[first - 1].role === 'assistant'
    && messages[first - 1].content.startsWith(clarifyPrefix) && messages[first - 2].role === 'user') {
    first -= 2;
  }
  if (!mentionWechat.test(latest.content) && first === messages.length - 1) return null;
  return messages.slice(first);
}

async function* textReply(text) {
  yield replyDelta(text);
  yield done;
}

async function* exportReply({ config, documentService, arkClient, args, signal }) {
  yield event({ type: 'status', message: '正在读取微信聊天并整理论文反馈…' });
  try {
    const report = await requestWechatReport({ config, documentService, arkClient, args, signal });
    const file = await saveWechatReport({ config, format: args.format, report, signal });
    yield replyDelta(report.itemCount
      ? `已合并出 ${report.itemCount} 项论文修改意见。清单保留了相关原话和发送时间。`
      : '这段时间没有提取到明确的论文修改意见。清单里有本次整理范围和转写缺失提示。');
    yield event({ type: 'download', file });
    yield done;
  } catch (error) {
    signal?.throwIfAborted();
    yield* textReply(error instanceof HttpError ? error.message : '微信整理失败，请重试。');
  }
}

async function openWechatChat({ config, documentService, arkClient, messages, allowWechat, signal }) {
  const thread = collectWechatTurn(messages);
  if (!thread) return null;
  let plan;
  try {
    plan = await planWechatAction({ config, arkClient, messages: thread, signal, inChat: true });
  } catch (error) {
    if (error instanceof HttpError && ['INVALID_WECHAT_DATE_RANGE', 'WECHAT_DATE_RANGE_TOO_LONG'].includes(error.code)) {
      return { body: textReply(clarifyPrefix + error.message + '。') };
    }
    throw error;
  }
  if (!plan) return null;
  if (!allowWechat) return { body: textReply(localOnlyMessage + '。') };
  if (!config.wechatMcp) {
    return { body: textReply('本机微信 MCP 还没配置。请在 `backend/.env` 中设置 `WECHAT_MCP_COMMAND`，重启后端后再发一次请求。') };
  }
  const requestedContact = plan.args?.contact;
  const declaredContact = requestedContact && thread.some(message => message.role === 'user' && message.content.includes(requestedContact));
  if (plan.missing || !declaredContact) {
    const fields = [...new Set(plan.missing ?? ['contact'])].map(field => field === 'contact' ? '微信里的联系人备注或群名' : '起止日期或时间');
    return { body: textReply(clarifyPrefix + '发一下' + fields.join('和') + '。') };
  }
  return { body: exportReply({ config, documentService, arkClient, args: plan.args, signal }), wechatExport: true };
}

module.exports = { openWechatChat };
