const { z } = require('zod');
const { readWechatHistory } = require('../mcp/wechat.client');
const { chunkText } = require('../documents/chunk');
const { validMinute } = require('../documents/transcript');
const { buildRevisionChecklist } = require('./revision.service');
const { packRevisionDocx } = require('../documents/revision-docx');
const { HttpError } = require('../utils/http-error');

const WECHAT_EXPORT_TOOL = 'exportWechatRevisionChecklist';
const minute = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
const wechatExportSchema = z.object({
  contact: z.string().trim().min(1).max(120).describe('用户指定的微信备注、昵称或群聊名称'),
  from: minute.describe('含开始分钟，格式 YYYY-MM-DDTHH:mm'),
  to: minute.describe('含结束分钟，格式 YYYY-MM-DDTHH:mm'),
  format: z.enum(['docx', 'markdown']).default('docx')
}).strict();
const parameters = z.toJSONSchema(wechatExportSchema);
delete parameters.$schema;

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

async function planWechatExport({ config, arkClient, request, signal }) {
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', dateStyle: 'short' }).format(new Date());
  const response = await arkClient.createCompletion({
    model: config.modelId,
    messages: [{
      role: 'system',
      content: [
        '把用户的一句话转成微信论文反馈整理工具的参数。按 Asia/Shanghai 理解时间，今天是 ' + today + '。',
        '只读取用户明确指定的一个联系人或群聊和一个起止范围，任何一个缺少或含糊时用文字请求补充，禁止猜联系人或日期。',
        '有日期但没写时刻时用起始日 00:00 和结束日 23:59。最近 N 天含今天，未写年份时用当前年。',
        '用户提到 Markdown 或 .md 时 format 取 markdown，其余情况默认 docx。参数完整时调用工具一次。'
      ].join('\n')
    }, { role: 'user', content: request }],
    max_tokens: config.maxTokens,
    temperature: 0.1,
    tool_choice: 'auto',
    tools: [{
      type: 'function',
      function: { name: WECHAT_EXPORT_TOOL, description: '用明确指定的联系人和时间范围整理微信论文反馈', parameters }
    }]
  }, { signal });
  const calls = response.choices[0]?.message?.tool_calls;
  const selected = Array.isArray(calls) && calls.length === 1 ? calls[0]?.function : null;
  let parsed;
  try {
    if (selected?.name === WECHAT_EXPORT_TOOL) parsed = wechatExportSchema.safeParse(JSON.parse(selected.arguments));
  } catch {
    // 参数无法解析时走同一个补充条件提示。
  }
  if (!parsed?.success) {
    throw new HttpError(400, '请写清微信联系人和起止日期，例如整理我跟王老师 11 月 3 日到 11 月 6 日的论文反馈', 'WECHAT_REQUEST_INCOMPLETE');
  }
  daysInRange(parsed.data.from, parsed.data.to);
  return parsed.data;
}

function prepareTranscript(history, from, to, maxBytes) {
  const messages = [];
  const warnings = [];
  let skipped = 0;
  let bytes = 0;
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
      const rawText = record['消息'];
      const text = typeof rawText === 'string' ? rawText.replace(/[\r\n]+/g, ' ').trim() : '';
      if (!text || /^(?:\[语音\]|语音消息|\[图片\]|\[视频\]|\[文件\])$/.test(text)) {
        skipped++;
        continue;
      }
      const speaker = typeof record['发送者'] === 'string' ? record['发送者'].replace(/[\r\n]+/g, ' ').trim() : '';
      const line = when.replace('T', ' ') + ' ' + (speaker || '发言人不明') + '：' + text;
      bytes += Buffer.byteLength(line, 'utf8') + 1;
      if (bytes > maxBytes) throw new HttpError(413, '微信文字记录超过处置上限，请缩小日期范围', 'WECHAT_TRANSCRIPT_TOO_LARGE');
      messages.push({ when, line });
    }
  }
  if (skipped) warnings.push('有 ' + skipped + ' 条返回记录缺少有效时间或可用文字，未参与归并。');
  messages.sort((left, right) => left.when.localeCompare(right.when));
  return { lines: messages.map(message => message.line), warnings };
}

async function exportWechatRevision({ config, arkClient, contact, from, to, format, signal }) {
  const days = daysInRange(from, to);
  const history = await readWechatHistory({ config, contact, days, signal });
  const { lines, warnings } = prepareTranscript(history, from, to, config.fileMaxBytes);
  const name = '微信论文修改清单';
  const metadata = [
    '整理对象为微信会话「' + contact + '」。',
    '时段为 ' + from.replace('T', ' ') + ' 至 ' + to.replace('T', ' ') + '（含边界）。',
    '共处理 ' + lines.length + ' 条返回的文字消息。',
    ...warnings
  ];
  const document = { name: '与' + contact + '的微信聊天记录', chunks: chunkText(lines.join('\n'), { markdown: false }) };
  const report = await buildRevisionChecklist({ config, arkClient, document, advisor: contact, signal }, { includeSections: true });
  const mediaType = format === 'markdown' ? 'text/markdown' :
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  const filename = name + (format === 'markdown' ? '.md' : '.docx');
  const markdownMetadata = metadata.map(line => line.replace(/[&<>]/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;'
  })[character]).replace(/([\\`*_\[\]~])/g, '\\$1')).join('\n\n');
  const exported = format === 'markdown'
    ? Buffer.from(report.markdown.replace('# 论文修改清单\n', () => '# 微信论文修改清单\n\n' + markdownMetadata + '\n'), 'utf8')
    : await packRevisionDocx({ title: '微信论文修改清单', metadata, sections: report.sections, lines });
  signal?.throwIfAborted();
  return { filename, mediaType, contentBase64: exported.toString('base64'), itemCount: report.itemCount };
}

module.exports = { WECHAT_EXPORT_TOOL, wechatExportSchema, planWechatExport, exportWechatRevision };
