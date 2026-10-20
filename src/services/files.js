export const FILE_MAX_BYTES = 2 * 1024 * 1024
export const FILE_UPLOAD_TIMEOUT_MS = 5 * 60 * 1000

export function validateFile(file) {
  if (!file || !/\.(txt|md)$/i.test(file.name)) throw new Error('目前支持 TXT、MD 文本文件')
  if (!file.size) throw new Error('文件内容为空')
  if (file.size > FILE_MAX_BYTES) throw new Error('文件不能超过 2 MB')
}

// 直接发送 File 的二进制内容，不把全文读入 Pinia，也不转换成 Base64。
export async function uploadFile({ file, scopeId, signal }) {
  validateFile(file)
  const query = new URLSearchParams({ name: file.name, scopeId })
  const controller = new AbortController()
  const onAbort = () => controller.abort(signal.reason)
  signal?.addEventListener('abort', onAbort, { once: true })
  if (signal?.aborted) onAbort()
  const timer = setTimeout(() => controller.abort(new DOMException('上传处理超时，请重试', 'TimeoutError')), FILE_UPLOAD_TIMEOUT_MS)
  try {
    controller.signal.throwIfAborted()
    let response
    try {
      response = await fetch(`http://localhost:3000/api/files?${query}`, {
        method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: file, signal: controller.signal
      })
    } catch {
      controller.signal.throwIfAborted()
      throw new Error('无法连接文件服务，请检查后端是否启动后重试')
    }
    const payload = await response.json().catch(() => null)
    controller.signal.throwIfAborted()
    if (response.status === 404) {
      throw new Error('未找到文件上传接口，请重启后端并确认请求地址正确（HTTP 404）')
    }
    if (!response.ok) throw new Error(payload?.error?.message || `上传失败（HTTP ${response.status}）`)
    if (!payload?.file?.id || payload.file.status !== 'ready') throw new Error('上传接口没有返回有效的文件信息')
    return payload.file
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
  }
}
