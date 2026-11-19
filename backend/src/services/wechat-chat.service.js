const { randomUUID } = require('node:crypto');
const { planWechatAction, readWechatReview } = require('./wechat-export.service');
const { isId } = require('./document.service');
const { localOnlyMessage } = require('../utils/local-request');
const { HttpError } = require('../utils/http-error');

const clarifyPrefix = '请补充微信整理条件。';
const mentionWechat = /微信|we\s*chat|weixin/i;
const confirmation = /^(?:我?确认(?:无误|整理|并导出|导出)?|继续整理|开始整理|就按这版整理)(?:[\s，,]+继续整理)?(?:[\s，,、：:]*(?:改成|用|导出|成)?\s*(?:Markdown|\.md|Word|\.docx))?[吧\s。!！]*$/i;
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

async function* reviewReply({ config, reviews, scopeId, args, signal }) {
  yield event({ type: 'status', message: '正在查找微信聊天记录并检查语音转写…' });
  try {
    const scope = isId(scopeId) ? scopeId : randomUUID();
    const oldReview = reviews.discard(scope);
    if (oldReview) yield event({ type: 'wechat-review-closed', id: oldReview, status: 'expired' });
    const draft = await readWechatReview({ config, ...args, signal });
    signal?.throwIfAborted();
    if (!draft.rows.length) {
      yield* textReply(['这段时间没有找到可供核对的微信记录。', ...draft.warnings].join('\n\n'));
      return;
    }
    const review = reviews.hold(scope, args, draft);
    yield replyDelta(`找到了 ${review.rows.length} 条记录。你可以在下面核对或修改，改完后在聊天框回复「确认整理」。`);
    yield event({ type: 'wechat-review', review });
    yield done;
  } catch (error) {
    signal?.throwIfAborted();
    yield* textReply(error instanceof HttpError ? error.message : '读取微信记录失败，请重试。');
  }
}

async function* exportReply({ config, reviews, arkClient, scopeId, input, format, signal }) {
  yield event({ type: 'status', message: '正在按你确认的内容归并意见并生成清单…' });
  try {
    const { file, itemCount } = await reviews.complete({ scopeId, input, format, config, arkClient, signal });
    yield replyDelta(itemCount
      ? `已合并出 ${itemCount} 项论文修改意见。清单保留了相关原话和发送时间。`
      : '这段时间没有提取到明确的论文修改意见。清单里有本次整理范围和转写缺失提示。');
    yield event({ type: 'download', file });
    yield event({ type: 'wechat-review-closed', id: input.id, status: 'confirmed' });
    yield done;
  } catch (error) {
    signal?.throwIfAborted();
    yield* textReply(error instanceof HttpError ? error.message : '微信整理失败，请重试。');
  }
}

async function openWechatChat({ config, arkClient, reviews, messages, scopeId, wechatReview, allowWechat, signal }) {
  const latest = messages.at(-1);
  const approval = latest?.role === 'user' && confirmation.test(latest.content.trim());
  if (approval && wechatReview) {
    if (!allowWechat) return { body: textReply(localOnlyMessage + '。') };
    const format = /Markdown|\.md/i.test(latest.content) ? 'markdown' : /Word|\.docx/i.test(latest.content) ? 'docx' : undefined;
    return { body: exportReply({ config, reviews, arkClient, scopeId, input: wechatReview, format, signal }), wechatWork: true };
  }
  if (approval && messages.some(message => message.role === 'assistant' && message.content.includes('回复「确认整理」'))) {
    return { body: textReply('当前会话没有待确认的微信记录，请先重新查询。') };
  }
  const thread = collectWechatTurn(messages);
  if (!thread) return null;
  let plan;
  try {
    plan = await planWechatAction({ config, arkClient, messages: thread, signal });
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
  return { body: reviewReply({ config, reviews, scopeId, args: plan.args, signal }), wechatWork: true };
}

module.exports = { openWechatChat };
