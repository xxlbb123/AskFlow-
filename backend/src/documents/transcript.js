const { chunkText } = require('./chunk');
const { HttpError } = require('../utils/http-error');

const datePart = '(?<year>\\d{4})[-/年](?<month>\\d{1,2})[-/月](?<day>\\d{1,2})日?';
const dateHeader = new RegExp(`^\\s*[\\[【]?${datePart}\\s*(?:(?:星期|周)[一二三四五六日天])?\\s*[\\]】]?\\s*$`);
const timestamp = new RegExp(
  `^\\s*[\\[【]?(?:${datePart}[T\\s]+)?(?<hour>\\d{1,2}):(?<minute>\\d{2})(?::\\d{2})?(?=$|\\s|[\\]】])`
);
const audioHeader = /^【[^】]*\.(?:mp3|wav|m4a|aac)】\s*$/i;
const pad = value => value.padStart(2, '0');
const dateString = ({ year, month, day }) => `${year}-${pad(month)}-${pad(day)}`;

function validMinute(value) {
  const timestamp = Date.parse(`${value}:00Z`);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 16) === value;
}

function filterTranscript(text, { from, to }) {
  if (from && to && from > to) {
    throw new HttpError(400, '开始时间不能晚于结束时间', 'INVALID_TRANSCRIPT_RANGE');
  }

  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const records = [];
  let date;
  let untimedLines = 0;
  let current;
  for (const [index, line] of lines.entries()) {
    const heading = dateHeader.exec(line)?.groups;
    if (heading) {
      date = dateString(heading);
      current = undefined;
      continue;
    }

    const time = timestamp.exec(line)?.groups;
    if (time) {
      if (time.year) date = dateString(time);
      const value = date && `${date}T${pad(time.hour)}:${time.minute}`;
      current = value && validMinute(value) ? { time: value, start: index, end: index + 1 } : undefined;
      if (current) records.push(current);
      else untimedLines++;
      continue;
    }

    if (audioHeader.test(line)) {
      current = undefined;
      date = undefined;
    }
    if (current) current.end = index + 1;
    else if (line.trim()) untimedLines++;
  }

  if (!records.length) {
    throw new HttpError(422, '筛选需要消息时间，例如 2026-11-03 09:30 王老师：……', 'TRANSCRIPT_TIMESTAMPS_REQUIRED');
  }
  const matched = records.filter(record => (!from || record.time >= from) && (!to || record.time <= to));
  const spans = [];
  for (const { start, end } of matched) {
    const previous = spans.at(-1);
    if (previous?.end === start) previous.end = end;
    else spans.push({ start, end });
  }

  const chunks = [];
  for (const { start, end } of spans) {
    for (const chunk of chunkText(lines.slice(start, end).join('\n'), { markdown: false })) {
      chunks.push({
        ...chunk, id: `chunk-${chunks.length + 1}`,
        startLine: start + chunk.startLine, endLine: start + chunk.endLine
      });
    }
  }
  return { chunks, matchedMessages: matched.length, untimedLines };
}

module.exports = { filterTranscript, validMinute };
