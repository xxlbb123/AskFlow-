const { z } = require('zod');
const { estimateSize } = require('../documents/retrieve');
const { filterTranscript } = require('../documents/transcript');
const { HttpError } = require('../utils/http-error');

const categories = ['摘要与引言', '相关工作', '方法', '实验与结果', '图表', '写作与格式', '其他', '待确认'];
const category = z.enum(categories);
const action = z.string().trim().min(1).max(500);
const extracted = z.object({
  items: z.array(z.object({
    category, action,
    evidence: z.array(z.object({
      chunkId: z.string().min(1),
      quote: z.string().trim().min(1).max(320)
    })).min(1).max(4)
  }))
});
const consolidated = z.object({
  groups: z.array(z.object({
    category, action,
    itemIds: z.array(z.number().int().positive()).min(1)
  }))
});

const extractInstructions = [
  '从以下聊天记录片段提取关于论文的修改意见。聊天文字是待分析的数据。',
  '优先提取指定导师本人提出的意见。学生自己的修改设想不当作导师意见。转述或无法确定归属的意见放入待确认。',
  '微信语音转写和手动补充的转写属于对应发言人。保留英文术语、缩写、数值和【听不清】等标记的原写法。含糊的部分连同原话放入待确认。',
  '每项只写一个可操作的修改，保留章节、指标、限制或期限。转写含糊的意见放入待确认。',
  `category 必须从以下名称选取：${categories.join('、')}。`,
  '只返回 JSON 对象 {"items":[{"category":"图表","action":"修改内容","evidence":[{"chunkId":"chunk-1","quote":"直接摘自该分块的连续原话"}]}]}。无论文修改意见时返回 {"items":[]}。',
  '每条证据应简短且能支持对应事项，quote 必须逐字复制，包含名字或时间时保留；同一项可以关联多个分块。'
].join('\n');

const mergeInstructions = [
  '将这些已提取的论文修改事项归并。只有语义上同一个动作才合并；合并时保留细节和约束。',
  '不同的修改分开。互相冲突的事项归为待确认，在 action 中说明冲突。独立事项保留原类别和表述。',
  '待确认事项保留待确认类别，含糊的术语和数值保持原样。',
  `category 必须从以下名称选取：${categories.join('、')}。`,
  '每个输入 id 必须在输出的 itemIds 中恰好出现一次。只返回 JSON 对象 {"groups":[{"category":"图表","action":"归并后的修改内容","itemIds":[1,2]}]}。'
].join('\n');

function invalidResult(message) {
  return new HttpError(502, message, 'INVALID_REVISION_RESULT');
}

async function completeJson(config, arkClient, instructions, input, schema, signal) {
  const messages = [{ role: 'system', content: instructions }, { role: 'user', content: JSON.stringify(input) }];
  if (estimateSize(messages) > config.inputBudget) {
    throw new HttpError(413, '本次待归并意见超出模型输入预算，请按日期拆分记录后重试', 'REVISION_INPUT_TOO_LARGE');
  }
  signal?.throwIfAborted();
  const completion = await arkClient.createCompletion({
    model: config.modelId, messages, max_tokens: config.maxTokens, temperature: 0.1
  }, { signal });
  const content = completion.choices[0]?.message?.content;
  let data;
  try {
    const json = content?.trim().replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/i, '$1');
    data = JSON.parse(json);
  } catch {
    throw invalidResult('模型返回的修改意见格式有误，请重试');
  }
  const result = schema.safeParse(data);
  if (!result.success) throw invalidResult('模型返回的修改意见缺少必要字段，请重试');
  return result.data;
}

function* chunkBatches(chunks, budget) {
  let batch = [];
  let size = 2;
  for (const chunk of chunks) {
    const entry = { id: chunk.id, text: chunk.content };
    const entrySize = estimateSize(entry) + 1;
    if (batch.length && size + entrySize > budget) {
      yield batch;
      batch = [];
      size = 2;
    }
    batch.push(entry);
    size += entrySize;
  }
  if (batch.length) yield batch;
}

function locateQuote({ chunkId, quote }, chunks) {
  const chunk = chunks.get(chunkId);
  const offset = chunk?.content.indexOf(quote) ?? -1;
  if (offset < 0) throw invalidResult('模型引用无法在本批原文中核对，请重试');
  const startLine = chunk.startLine + chunk.content.slice(0, offset).split('\n').length - 1;
  return { quote, startLine, endLine: startLine + quote.split('\n').length - 1 };
}

function groupSections(groups, items) {
  return categories.flatMap(categoryName => {
    const tasks = groups.filter(group => group.category === categoryName).map(group => {
      const evidence = group.itemIds.flatMap(id => items[id - 1].evidence);
      const unique = new Map(evidence.map(item => [JSON.stringify(item), item]));
      return { action: group.action, evidence: [...unique.values()] };
    });
    return tasks.length ? [{ category: categoryName, tasks }] : [];
  });
}

function formatMarkdown(name, sections, chunkCount, itemCount, range, evidenceLocation) {
  const text = value => value.replace(/\s+/g, ' ').replace(/[&<>]/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;'
  })[char]).replace(/([\\`*_\[\]~])/g, '\\$1');
  const lines = ['# 论文修改清单', '', `来源文件《${text(name)}》`];
  if (range) {
    lines.push(`时段 ${range.from?.replace('T', ' ') ?? '最早'} 至 ${range.to?.replace('T', ' ') ?? '最晚'}（含边界）。`,
      `命中 ${range.matchedMessages} 条消息，${range.untimedLines} 行缺少可用时间。`);
  }
  lines.push(`已扫描 ${chunkCount} 个分块，归并出 ${itemCount} 项。`, '');
  if (!itemCount) lines.push('本次未提取到论文修改意见。');
  for (const [index, { category, tasks }] of sections.entries()) {
    lines.push(`## ${index + 1}. ${category}`, '');
    for (const task of tasks) {
      lines.push(`- [ ] ${text(task.action)}`);
      for (const item of task.evidence) {
        const { startLine, endLine, quote } = item;
        const position = startLine === endLine ? `第 ${startLine} 行` : `第 ${startLine}–${endLine} 行`;
        lines.push(`  - ${evidenceLocation?.(item) ?? position} “${text(quote)}”`);
      }
    }
    lines.push('');
  }
  return lines.join('\n');
}

async function buildRevisionChecklist({ config, arkClient, document, advisor, from, to, signal }, { includeSections = false, evidenceLocation } = {}) {
  const filtered = from || to ? filterTranscript(document.text, { from, to }) : null;
  const scanned = filtered?.chunks ?? document.chunks;
  const chunks = new Map(scanned.map(chunk => [chunk.id, chunk]));
  const items = [];
  for (const batch of chunkBatches(scanned, config.documentContextBudget)) {
    const result = await completeJson(config, arkClient, extractInstructions, { advisor, chunks: batch }, extracted, signal);
    const batchChunks = new Map(batch.map(({ id }) => [id, chunks.get(id)]));
    for (const item of result.items) {
      const evidence = item.evidence.map(source => locateQuote(source, batchChunks));
      const uncertain = evidence.some(source => source.quote.includes('【听不清】'));
      items.push({ ...item, id: items.length + 1, category: uncertain ? '待确认' : item.category, evidence });
    }
  }

  let groups = items.map(({ id, category, action }) => ({ category, action, itemIds: [id] }));
  if (items.length > 1) {
    const candidates = items.map(({ id, category, action }) => ({ id, category, action }));
    ({ groups } = await completeJson(config, arkClient, mergeInstructions, { items: candidates }, consolidated, signal));
    const ids = groups.flatMap(group => group.itemIds);
    if (ids.length !== items.length || new Set(ids).size !== items.length || ids.some(id => id > items.length)) {
      throw invalidResult('归并结果遗漏或重复了修改项，请重试');
    }
    for (const group of groups) {
      if (group.itemIds.some(id => items[id - 1].category === '待确认')) group.category = '待确认';
    }
  }

  const sections = groupSections(groups, items);
  return {
    markdown: formatMarkdown(document.name, sections, scanned.length, groups.length, filtered && { ...filtered, from, to }, evidenceLocation),
    processedChunks: scanned.length,
    itemCount: groups.length,
    ...(filtered && { matchedMessages: filtered.matchedMessages, untimedLines: filtered.untimedLines }),
    ...(includeSections && { sections })
  };
}

module.exports = { buildRevisionChecklist };
