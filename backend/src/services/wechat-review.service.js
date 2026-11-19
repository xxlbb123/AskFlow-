const { randomUUID } = require('node:crypto');
const { z } = require('zod');
const { HttpError } = require('../utils/http-error');
const { buildWechatReport } = require('./wechat-export.service');
const { saveWechatReport } = require('./wechat-reports.service');

const reviewInput = z.object({
  id: z.string().uuid(),
  edits: z.array(z.object({ index: z.number().int().nonnegative(), text: z.string() }).strict()).default([])
}).strict();
const reviewLifetimeMs = 2 * 60 * 60 * 1000;

function createWechatReviews() {
  const entries = new Map();

  function get(scopeId, id) {
    const entry = entries.get(scopeId);
    if (entry?.id !== id) throw new HttpError(404, '这批微信记录的校对已结束或过期，请重新查询。', 'WECHAT_REVIEW_NOT_FOUND');
    return entry;
  }

  function preview(entry) {
    const { id, scopeId, draft, args } = entry;
    if (!draft) throw new HttpError(404, '这批微信记录已确认。', 'WECHAT_REVIEW_NOT_FOUND');
    return { id, scopeId, ...args, rows: draft.rows, warnings: draft.warnings };
  }

  function discard(scopeId) {
    const previous = entries.get(scopeId);
    if (previous?.generating) throw new HttpError(409, '当前会话正在整理另一批微信记录。', 'WECHAT_REVIEW_BUSY');
    clearTimeout(previous?.timer);
    entries.delete(scopeId);
    return previous?.draft ? previous.id : undefined;
  }

  function hold(scopeId, args, draft) {
    discard(scopeId);
    const entry = { id: randomUUID(), scopeId, args, draft };
    entry.timer = setTimeout(() => entries.delete(scopeId), reviewLifetimeMs);
    entry.timer.unref();
    entries.set(scopeId, entry);
    return preview(entry);
  }

  async function complete({ scopeId, input, format, config, arkClient, signal }) {
    const parsed = reviewInput.safeParse(input);
    if (!parsed.success) throw new HttpError(400, '校对内容格式无效，请重新查询后再确认。', 'INVALID_WECHAT_REVIEW');
    const { id, edits } = parsed.data;
    const entry = get(scopeId, id);
    if (entry.result) return entry.result;
    if (entry.generating) throw new HttpError(409, '这批微信记录正在整理中。', 'WECHAT_REVIEW_BUSY');
    const editsByIndex = new Map(edits.map(edit => [edit.index, edit.text]));
    if (editsByIndex.size !== edits.length || edits.some(edit => edit.index >= entry.draft.rows.length)) {
      throw new HttpError(400, '校对记录和读取结果不一致，请重新查询。', 'INVALID_WECHAT_REVIEW');
    }
    const args = { ...entry.args, format: format ?? entry.args.format };
    const rows = entry.draft.rows.map(row => editsByIndex.has(row.index)
      ? { ...row, text: editsByIndex.get(row.index), edited: true } : row);
    entry.generating = true;
    try {
      const review = { ...entry.draft, rows };
      const report = await buildWechatReport({ config, arkClient, ...args, review, signal });
      const file = await saveWechatReport({ config, format: args.format, report, signal });
      entry.result = { file, itemCount: report.itemCount };
      entry.draft = undefined;
      return entry.result;
    } finally {
      entry.generating = false;
    }
  }

  return { discard, hold, complete, read: (scopeId, id) => preview(get(scopeId, id)) };
}

module.exports = { createWechatReviews };
