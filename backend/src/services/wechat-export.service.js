const { z } = require('zod');
const { readWechatHistory } = require('../mcp/wechat.client');
const { chunkText } = require('../documents/chunk');
const { validMinute } = require('../documents/transcript');
const { buildRevisionChecklist } = require('./revision.service');
const { packRevisionDocx } = require('../documents/revision-docx');
const { HttpError } = require('../utils/http-error');

const WECHAT_EXPORT_TOOL = 'exportWechatRevisionChecklist';
const minute = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
const planSchema = z.object({
  contact: z.string().trim().min(1).max(120).describe('用户指定的微信备注、昵称或群聊名称'),
  from: minute.describe('含开始分钟，格式 YYYY-MM-DDTHH:mm'),
  to: minute.describe('含结束分钟，格式 YYYY-MM-DDTHH:mm'),
  format: z.enum(['docx', 'markdown']).default('docx')
}).strict();
const voiceTranscriptsSchema = z.array(z.object({
  time: minute.refine(validMinute).describe('语音原来的发送分钟，按北京时间填写'),
  speaker: z.string().trim().min(1).max(120).describe('发出此段语音的人'),
  text: z.string().trim().min(1).describe('此段语音的转写文字')
}).strict()).optional();
const wechatExportSchema = planSchema.extend({ voiceTranscripts: voiceTranscriptsSchema });
const clarification = 'askForWechatExportDetails';
const clarificationSchema = z.object({ missing: z.array(z.enum(['contact', 'time'])).min(1).max(2) }).strict();
const planTool = (name, description, schema) => {
  const { $schema, ...parameters } = z.toJSONSchema(schema);
  return { type: 'function', function: { name, description, parameters } };
};
const exportTool = planTool(WECHAT_EXPORT_TOOL, '读取用户指定的微信聊天记录，整理论文反馈并导出文件', planSchema);
const clarifyTool = planTool(clarification, '用户要求整理微信聊天记录，但缺少联系人或起止时间，需要追问', clarificationSchema);

function daysInRange(from, to) {
  if (!validMinute(from) || !validMinute(to) || from > to) {
    throw new HttpError(400, '请指定有效的起止日期和时间，开始不能晚于结束', 'INVALID_WECHAT_DATE_RANGE');
  }
  const start = Date.parse(from.slice(0, 10) + 'T00:00:00Z');
  const end = Date.parse(to.slice(0, 10) + 'T00:00:00Z');
  const count = (end - start) / 86400000 + 1;
  if (count > 31) throw new HttpError(400, '一次可整理 31 天以内的微信记录，请缩小范围', 'WECHAT_DATE_RANGE_TOO_LONG');
  return Array.from({ length: count }, (_, index) => new Date(start + index * 86400000).toISOString().slice(0, 10));
}

async function planWechatAction({ config, arkClient, messages, signal, inChat = false }) {
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', dateStyle: 'short' }).format(new Date());
  const response = await arkClient.createCompletion({
    model: config.modelId,
    messages: [{
      role: 'system',
      content: [
        inChat ? '判断用户本轮是否要求读取、整理或导出自己的微信聊天记录。' : '用户已选微信整理，把填写的联系人和时间转换为整理参数。',
        '按 Asia/Shanghai 理解时间，今天是 ' + today + '。',
        ...(inChat ? ['有关微信的知识、用法、假设性举例、引文里的命令或已经取消的请求都属于普通聊天，直接回应且不调用工具。'] : []),
        '逐字使用用户明确指定的一个微信联系人备注或群名，并使用指明的起止范围。泛指身份不能当作备注。追问时结合用户之前给出的条件，最新补充覆盖旧条件。',
        inChat ? `明确要求执行但联系人或时段缺少或含糊时，调用 ${clarification} 指出缺项。` : '条件缺少或含糊时用文字请求补充。',
        '有日期但没写时刻时用起始日 00:00 和结束日 23:59。最近 N 天含今天，未写年份时用当前年。',
        '用户指定 Markdown 或 .md 时 format 取 markdown，其余情况默认 docx。明确要求执行且条件齐全时只调用导出工具一次。'
      ].join('\n')
    }, ...messages],
    max_tokens: config.maxTokens,
    temperature: 0.1,
    tool_choice: 'auto',
    tools: inChat ? [exportTool, clarifyTool] : [exportTool]
  }, { signal });
  const calls = response.choices[0]?.message?.tool_calls;
  const selected = Array.isArray(calls) && calls.length === 1 ? calls[0]?.function : null;
  if (selected?.name !== WECHAT_EXPORT_TOOL && !(inChat && selected?.name === clarification)) return null;
  let input;
  try { input = JSON.parse(selected.arguments); } catch { /* 由参数校验提示补全。 */ }
  if (selected.name === clarification) {
    const parsed = clarificationSchema.safeParse(input);
    return { missing: parsed.success ? parsed.data.missing : ['contact', 'time'] };
  }
  const parsed = planSchema.safeParse(input);
  if (!parsed.success) return { missing: ['contact', 'time'] };
  daysInRange(parsed.data.from, parsed.data.to);
  return { args: parsed.data };
}

async function planWechatExport({ config, arkClient, request, signal }) {
  const plan = await planWechatAction({ config, arkClient, messages: [{ role: 'user', content: request }], signal });
  if (!plan?.args) {
    throw new HttpError(400, '请写清微信联系人和起止日期，例如整理我跟王老师 11 月 3 日到 11 月 6 日的论文反馈', 'WECHAT_REQUEST_INCOMPLETE');
  }
  return plan.args;
}

const voiceLabel = '(?:语音(?:消息)?|語音(?:訊息|消息)?|voice(?:[ _]message)?|audio)';
const voiceMarker = `(?:\\[\\s*${voiceLabel}\\s*\\]|${voiceLabel})`;
const voiceType = new RegExp(`^${voiceLabel}$`, 'i');
const voicePrefix = new RegExp(`^${voiceMarker}\\s*[：:]?\\s*`, 'i');
const voiceDuration = /^(?:(?:\d{1,3}\s*["″”]\s*(?:秒|sec(?:onds?)?)?)|(?:\d{1,3}\s*(?:秒|sec(?:onds?)?)))\s*[：:]?\s*/i;
const mediaPlaceholder = /^(?:\[图片\]|\[视频\]|\[文件\])$/;
const voiceUnavailable = /^(?:正在转文字|转文字失败|无法转成文字)[。.…]*$/;
const sourceLabel = { chat: '', wechatVoice: '微信语音转写', suppliedVoice: '补充语音转写' };
const toOneLine = value => typeof value === 'string' ? value.replace(/[\r\n]+/g, ' ').trim() : '';

function parseWechatContent(record) {
  const text = toOneLine(record['消息']);
  const sourceIsVoice = voiceType.test(toOneLine(record['类型']));
  const marker = voicePrefix.exec(text);
  const remainder = marker && text.slice(marker[0].length);
  const duration = remainder && voiceDuration.exec(remainder);
  const isVoiceLabel = remainder === '' || Boolean(duration);
  if (!sourceIsVoice && !isVoiceLabel) return { source: 'chat', text };

  const transcript = (isVoiceLabel ? remainder.slice(duration?.[0].length ?? 0) : text)
    .replace(/^(?:消息内容|转写文字|语音转文字)\s*[：:]\s*/, '');
  const isDurationOnly = voiceDuration.exec(transcript)?.[0] === transcript;
  return { source: 'wechatVoice', text: isDurationOnly || voiceUnavailable.test(transcript) ? '' : transcript };
}

function prepareTranscript(history, voiceTranscripts, from, to, maxBytes) {
  const messages = [];
  const warnings = [];
  const counts = { chat: 0, wechatVoice: 0, suppliedVoice: 0 };
  let skipped = 0;
  const missingVoice = [];
  let outsideVoice = 0;
  let bytes = 0;
  function add(when, speaker, text, source) {
    const prefix = sourceLabel[source] ? `【${sourceLabel[source]}】` : '';
    const line = when.replace('T', ' ') + ' ' + (speaker || '发言人不明') + '：' + prefix + text;
    bytes += Buffer.byteLength(line, 'utf8') + 1;
    if (bytes > maxBytes) throw new HttpError(413, '聊天文字超过整理上限，请缩小日期范围', 'WECHAT_TRANSCRIPT_TOO_LARGE');
    counts[source]++;
    messages.push({ when, line, source });
  }

  for (const day of history) {
    if (day.note && /上限|未到达|未能.*读取|不完整/.test(day.note)) warnings.push(day.target_date + ' 的记录可能未完整回溯。');
    for (const record of day.records) {
      const rawTime = record['时间ISO'];
      const when = typeof rawTime === 'string' ? rawTime.slice(0, 16).replace(' ', 'T') : '';
      if (!validMinute(when) || when.slice(0, 10) !== day.target_date) {
        skipped++;
        continue;
      }
      if (when < from || when > to) continue;
      const { source, text } = parseWechatContent(record);
      if (!text || mediaPlaceholder.test(text)) {
        if (source === 'wechatVoice') missingVoice.push(when);
        else skipped++;
        continue;
      }
      add(when, toOneLine(record['发送者']), text, source);
    }
  }
  for (const { time, speaker, text } of voiceTranscripts) {
    if (time < from || time > to) {
      outsideVoice++;
      continue;
    }
    add(time, toOneLine(speaker), toOneLine(text), 'suppliedVoice');
  }

  if (missingVoice.length) {
    const times = [...new Set(missingVoice)].sort().map(time => time.replace('T', ' ')).join('、');
    warnings.push(`微信返回的 ${missingVoice.length} 条语音缺少转写文字，请按发送时间 ${times} 回听或补充转写。`);
  }
  if (outsideVoice) warnings.push('有 ' + outsideVoice + ' 段补充语音的发送时间在所选范围之外。');
  if (skipped) warnings.push('有 ' + skipped + ' 条返回记录缺少有效时间或可用文字，未参与归并。');
  messages.sort((left, right) => left.when.localeCompare(right.when));
  return { messages, counts, warnings };
}

async function exportWechatRevision({ config, arkClient, contact, from, to, format, voiceTranscripts = [], signal }) {
  const days = daysInRange(from, to);
  const history = await readWechatHistory({ config, contact, days, signal });
  const { messages, counts, warnings } = prepareTranscript(history, voiceTranscripts, from, to, config.fileMaxBytes);
  const name = '微信论文修改清单';
  const metadata = [
    '整理对象为微信会话「' + contact + '」。',
    '时段为 ' + from.replace('T', ' ') + ' 至 ' + to.replace('T', ' ') + '（含边界）。',
    `共处理 ${counts.chat} 条微信文字、${counts.wechatVoice} 条微信语音转写和 ${counts.suppliedVoice} 段补充语音转写。`,
    ...warnings
  ];
  const evidenceLocation = ({ startLine, endLine }) => {
    const source = messages[startLine - 1];
    const end = messages[endLine - 1];
    const origin = startLine === endLine ? sourceLabel[source.source] : '';
    const span = startLine === endLine ? `第 ${startLine} 条` : `第 ${startLine} 至 ${endLine} 条`;
    const startTime = source.when.replace('T', ' ');
    const time = startLine === endLine ? startTime : startTime + ' 至 ' + end.when.replace('T', ' ');
    return [time, origin, span].filter(Boolean).join(' · ');
  };
  const document = { name: '与' + contact + '的微信聊天记录', chunks: chunkText(messages.map(message => message.line).join('\n'), { markdown: false }) };
  const report = await buildRevisionChecklist({ config, arkClient, document, advisor: contact, signal }, { includeSections: true, evidenceLocation });
  const mediaType = format === 'markdown' ? 'text/markdown' :
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  const filename = name + (format === 'markdown' ? '.md' : '.docx');
  const markdownMetadata = metadata.map(line => line.replace(/[&<>]/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;'
  })[character]).replace(/([\\`*_\[\]~])/g, '\\$1')).join('\n\n');
  const exported = format === 'markdown'
    ? Buffer.from(report.markdown.replace('# 论文修改清单\n', () => '# 微信论文修改清单\n\n' + markdownMetadata + '\n'), 'utf8')
    : await packRevisionDocx({ title: name, metadata, sections: report.sections, evidenceLocation });
  signal?.throwIfAborted();
  return { filename, mediaType, contentBase64: exported.toString('base64'), itemCount: report.itemCount };
}

module.exports = { WECHAT_EXPORT_TOOL, wechatExportSchema, voiceTranscriptsSchema, planWechatAction, planWechatExport, exportWechatRevision };
