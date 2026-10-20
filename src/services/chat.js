const createChatError = (payload, fallback = '聊天接口请求失败') => {
  const error = payload?.error ?? payload
  if (error?.code === 'InvalidEndpoint.ClosedEndpoint') {
    return new Error('模型接入点已关闭或暂时不可用，请检查模型服务配置')
  }
  return new Error(typeof error === 'string' ? error : error?.message || fallback)
}

// 请求层只负责 HTTP 请求与流式解析，通过 onDelta 把新增文字交给 Store。
export async function streamChat({ messages, fileIds, scopeId, signal, onDelta, onSources, onStatus }) {
  let reader // 保存响应数据的读取器，finally 中也需要使用。

  try {
    // 这里使用fetch来发出请求
    const response = await fetch('http://localhost:3000/api/chat', {
      method: 'POST',
      signal, // 接收 AbortController 发出的取消通知。
      headers: { 'Content-Type': 'application/json' },//告诉后端，请求体使用JSON格式
      body: JSON.stringify({ messages, ...(fileIds?.length ? { fileIds, scopeId } : {}) })
    })
    // 这里就是await fetch得到response时，AI的完整回复可能还没有生成完，后面还需要继续读取response.body
    if (!response.ok) {
      const payload = await response.json().catch(() => null)
      signal?.throwIfAborted()
      throw createChatError(payload, `聊天接口请求失败（HTTP ${response.status}）`)
    }
    if (!response.body) throw new Error('API 请求失败')
    // response.body是一个ReadableStream,可以通过它读取已经到达的数据,也可以等待后续数据到达   
    reader = response.body.getReader() // 从响应体中分批读取数据。
    const decoder = new TextDecoder() // 把 Uint8Array 字节数据转换成文字。
    let buffer = '' // 网络分块可能截断一行 JSON，先保留不完整的文字。
    let finished = false // 记录是否收到了[DONE]结束标记。
    let hasSseData = false
    let hasReplyText = false
    let finishReason = null
    const nonSseLines = [] // 兼容旧后端把错误 JSON 误标为流式响应的情况。

    // readline负责解析一行已经接收完整的数据
    const readLine = (line) => {
      // 非 data: 行（例如空行）跳过，只结束本次 readLine 调用。
      if (!line.startsWith('data:')) {
        if (!hasSseData) nonSseLines.push(line)
        return
      }
      const data = line.slice(5).trim() //去掉‘data:’字符串，并且去掉前后空白得到JSON字符串
      if (!data) return
      hasSseData = true
      // 判断是否收到了结束标志
      if (data === '[DONE]') {
        finished = true
        return
      }
      const json = JSON.parse(data)//将JSON字符串转换为JS对象
      if (json.error) throw createChatError(json)
      if (json.type === 'sources' && Array.isArray(json.sources)) onSources?.(json.sources, json.mode)
      if (json.type === 'status' && typeof json.message === 'string') onStatus?.(json.message)
      const choice = json.choices?.[0]
      if (typeof choice?.finish_reason === 'string') finishReason = choice.finish_reason
      if (!hasReplyText && choice?.delta?.reasoning_content) onStatus?.('正在思考…')
      const delta = choice?.delta?.content
      if (typeof delta === 'string' && delta) {
        if (delta.trim()) hasReplyText = true
        onDelta(delta)
      }
    }

    while (!finished) {
      const { done, value } = await reader.read() //等待下一批数据，并且返回一个对象
      signal?.throwIfAborted() //这个是用来检查请求是否已经被取消，如果取消了那就抛出取消异常
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true })
      const lines = buffer.split('\n') //按照换行符来进行切分
      buffer = lines.pop() || '' // 完整行现在处理，最后一段留待下次拼接。
      for (const line of lines) {
        readLine(line)
        if (finished) break
      }
      if (done) {
        // 最后一行可能没有换行符，流结束时还需要处理 buffer。
        if (!finished && buffer.trim()) readLine(buffer)
        break
      }
    }
    // 没有收到任何 data: 事件时，不能把接口错误当成一次正常的空回复。
    if (!hasSseData) {
      let payload
      try {
        payload = JSON.parse(nonSseLines.join('\n'))
      } catch {
        // 无法解析的响应同样交给页面显示错误。
      }
      throw createChatError(payload, '聊天接口没有返回有效的流式响应，请检查模型服务配置')
    }
    if (!finished) throw new Error('AI 回复连接提前结束，已收到的内容仍保留，请重试')
    if (finishReason === 'length') throw new Error(hasReplyText
      ? 'AI 回复达到输出长度上限，已保留收到的内容，可继续提问'
      : '模型输出达到长度上限，但没有生成回复正文，请重试')
    if (finishReason === 'content_filter') throw new Error('模型限制了本次回复，请调整问题后重试')
    if (!hasReplyText) throw new Error('AI 本次没有返回回复正文，请重试')
  } finally {
    await reader?.cancel().catch(() => {}) //cancel是用来取消继续读取响应流，然后catch是忽略取消读取过程中产生的错误
    reader?.releaseLock() //释放读取器对响应流的占用
  }
}
