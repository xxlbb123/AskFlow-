const apiBase = import.meta.env?.VITE_API_BASE_URL || 'http://localhost:3000'

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
