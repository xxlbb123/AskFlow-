import { apiBase } from './api.js'

const isId = value => typeof value === 'string' && /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(value)

export function readWechatDownload(value) {
  if (!value || !isId(value.id) ||
      !['docx', 'markdown'].includes(value.format)) return null
  return { id: value.id, format: value.format }
}

export function describeWechatDownload(value) {
  const file = readWechatDownload(value)
  if (!file) return null
  return {
    href: `${apiBase}/api/wechat/reports/${file.id}/${file.format}`,
    label: file.format === 'markdown' ? '下载 Markdown 清单' : '下载 Word 清单'
  }
}

export function wechatReviewMetadata(value) {
  if (!value || !isId(value.id) || !['pending', 'confirmed', 'expired'].includes(value.status)) return null
  return { id: value.id, status: value.status }
}

export function readWechatReview(value) {
  if (!value || !isId(value.id) || !Array.isArray(value.rows)) return null
  const { id, contact, from, to, rows, warnings } = value
  return {
    id, contact, from, to, warnings: Array.isArray(warnings) ? warnings : [], status: 'pending',
    rows: rows.map(row => ({ ...row, editedText: row.text }))
  }
}

export async function fetchWechatReview(scopeId, id) {
  const response = await fetch(`${apiBase}/api/wechat/reviews/${scopeId}/${id}`)
  if (response.status === 404) return null
  if (!response.ok) throw new Error('暂时无法恢复微信校对记录，请重新查询')
  return readWechatReview(await response.json())
}
