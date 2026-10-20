// 只在用户点击复制按钮时调用，保留原文中的换行、空格和 Markdown 标记。
export const copyText = async (text) => {
  if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) {
    throw new Error('当前环境不支持剪贴板写入')
  }
  await navigator.clipboard.writeText(text)
}
