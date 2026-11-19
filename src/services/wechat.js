import { apiBase } from './api.js'

const reportId = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i

export function readWechatDownload(value) {
  if (!value || typeof value.id !== 'string' || !reportId.test(value.id) ||
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

export async function exportWechatChecklist(request, voiceTranscripts, signal) {
  const response = await fetch(`${apiBase}/api/wechat/revision-checklist`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ request, voiceTranscripts }),
    signal
  })
  if (!response.ok) {
    const payload = await response.json().catch(() => null)
    throw new Error(payload?.error?.message || `微信整理失败（HTTP ${response.status}）`)
  }
  const mediaType = response.headers.get('Content-Type') || ''
  if (!mediaType.startsWith('text/markdown') &&
    !mediaType.startsWith('application/vnd.openxmlformats-officedocument.wordprocessingml.document')) {
    throw new Error('后端没有返回可下载的文件')
  }
  return {
    file: await response.blob(),
    filename: `微信论文修改清单.${mediaType.startsWith('text/markdown') ? 'md' : 'docx'}`
  }
}
