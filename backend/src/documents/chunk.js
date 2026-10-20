// 参考 yuan-agent：固定长度的滑动窗口，相邻块保留重叠内容。
// 用 Unicode 字符计数，避免从 emoji 中间切开；行号对应换行归一化后的原文。
function chunkText(text, { chunkSize = 900, overlap = 160 } = {}) {
  if (!Number.isSafeInteger(chunkSize) || chunkSize < 1 || !Number.isSafeInteger(overlap)
    || overlap < 0 || overlap >= chunkSize) throw new RangeError('切分长度必须大于重叠长度，且重叠长度不能为负数');

  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const characters = Array.from(lines.join('\n'));
  const lineStarts = [];
  const sections = [];
  const headings = [];
  let position = 0;
  let fence = null;
  for (const line of lines) {
    lineStarts.push(position);
    position += Array.from(line).length + 1;
    const marker = line.match(/^\s{0,3}(`{3,}|~{3,})/);
    const heading = !fence && line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (heading) {
      headings.length = heading[1].length;
      headings[heading[1].length - 1] = heading[2];
    }
    sections.push(headings.filter(Boolean).join(' / ') || '正文');
    if (marker) {
      if (!fence) fence = marker[1];
      else if (marker[1][0] === fence[0] && marker[1].length >= fence.length
        && /^\s{0,3}(`{3,}|~{3,})\s*$/.test(line)) fence = null;
    }
  }
  const lineAt = offset => {
    let low = 0;
    let high = lineStarts.length;
    while (low + 1 < high) {
      const middle = Math.floor((low + high) / 2);
      if (lineStarts[middle] <= offset) low = middle;
      else high = middle;
    }
    return low;
  };

  const chunks = [];
  for (let start = 0; start < characters.length; start += chunkSize - overlap) {
    const end = Math.min(start + chunkSize, characters.length);
    let from = start;
    let to = end;
    while (from < to && /\s/u.test(characters[from])) from++;
    while (to > from && /\s/u.test(characters[to - 1])) to--;
    if (from < to) chunks.push({ id: `chunk-${chunks.length + 1}`, section: sections[lineAt(from)],
      startLine: lineAt(from) + 1, endLine: lineAt(to - 1) + 1, content: characters.slice(from, to).join('') });
    // 最后一块已覆盖文件尾部，不再生成只包含重复尾部的小块。
    if (end === characters.length) break;
  }
  return chunks;
}

module.exports = { chunkText };
