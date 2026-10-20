import { computed, onScopeDispose, ref } from 'vue'
import { defineStore } from 'pinia'
import { streamChat } from '../services/chat.js'
import { uploadFile, validateFile } from '../services/files.js'
import { CHAT_STORAGE_KEY, chatStorage, chatHistorySerializer, chatStorageError as storageError } from '../utils/chat-storage.js'
// 这里pinia使用了setup store写法
export const useChatStore = defineStore('chat', () => {
  // 这部分相当于是state
  const sessions = ref([]) //保存所有已经创建的会话
  const activeSessionId = ref(null) //当前选中的会话id
  const newChatDraft = ref('')//新聊天中尚未发送的输入内容
  const draftVersion = ref(0) //点击“新建聊天”的次数标记
  // 空白聊天有附件范围，但仍不是侧栏会话；首次发送时一并迁移到会话。
  const newChatScopeId = ref(crypto.randomUUID())
  const newChatAttachments = ref([])
  const newChatAttachmentError = ref('')
  const uploads = new Map()
  const originalFiles = new Map() // 仅为重试保留 File，不属于会话展示数据。

  // 请求控制器不属于可展示的会话数据，单独存放。
  const requests = new Map() //保存会话ID与请求控制器的对应关系

  // 下面这部分相当于是getters，根据原始数据计算当前会话
  // 这个用来存储当前会话对象
  const activeSession = computed(() =>
    sessions.value.find(session => session.id === activeSessionId.value) ?? null
  )
  // 存储当前会话的消息数组
  const messages = computed(() => activeSession.value?.messages ?? [])
  const isGenerating = computed(() => activeSession.value?.isGenerating ?? false)
  const pendingAttachments = computed(() => activeSession.value?.pendingAttachments ?? newChatAttachments.value)
  const referenceFile = computed(() => activeSession.value?.documents?.[0] ?? null)
  const attachmentError = computed(() => activeSession.value?.attachmentError ?? newChatAttachmentError.value)
  const canSend = computed(() => pendingAttachments.value.every(file => file.status === 'ready'))
  const generationStatus = computed(() => activeSession.value?.generationStatus ?? '')
  const canRetryReply = computed(() => !isGenerating.value && messages.value.at(-1)?.role === 'user')
  // 这个是排序之后的会话列表
  const orderedSessions = computed(() =>
    // 先通过[...sessions.value]复制数组，避免sort()直接改变原数组的顺序；后面的比较函数让最近发送过消息的会话排在前面
    [...sessions.value].sort((a, b) => b.updatedAt - a.updatedAt)
  )
  // 每个已有会话保存自己的输入草稿；未发送的新聊天使用独立草稿。

  const inputMessage = computed({
    get: () => activeSession.value?.draft ?? newChatDraft.value,
    set: (value) => {
      // 如果是空白的新聊天，那么 此时读取修改的位置newChatDraft
      // 否则如果是已经选中的某个会话，那么这里保存的就是这个会话未发送的draft
      if (activeSession.value) activeSession.value.draft = value
      else newChatDraft.value = value 
    }
  })
  //  相当于是actions，修改状态，执行业务操作
  const startNewChat = () => {
    for (const file of newChatAttachments.value) {
      uploads.get(file.id)?.abort()
      originalFiles.delete(file.id)
    }
    newChatAttachments.value = []
    newChatAttachmentError.value = ''
    newChatScopeId.value = crypto.randomUUID()
    activeSessionId.value = null
    newChatDraft.value = ''
    draftVersion.value += 1
  }

  const selectSession = (id) => {
    if (sessions.value.some(session => session.id === id)) {
      activeSessionId.value = id
    }
  }
  // 删除会话的时候会取消对应请求
  const deleteSession = (id) => {
    const session = sessions.value.find(item => item.id === id)
    if (!session) return
    requests.get(id)?.abort() // 在删除会话的时候，取消对应会话的请求
    requests.delete(id)
    // 移除上传中的附件
    for (const file of session.pendingAttachments) {
      uploads.get(file.id)?.abort()
      uploads.delete(file.id)
      originalFiles.delete(file.id)
    }
    sessions.value = sessions.value.filter(item => item.id !== id)
    if (activeSessionId.value === id) startNewChat()
  }

  const createSession = (content) => {
    const titleCharacters = Array.from(content.replace(/\s+/g, ' '))
    const timestamp = Date.now()
    const id = crypto.randomUUID()
    // unshift方法将新会话放到数组开头
    sessions.value.unshift({
      id,
      title: titleCharacters.slice(0, 24).join('') + (titleCharacters.length > 24 ? '…' : ''),
      createdAt: timestamp,
      updatedAt: timestamp,
      messages: [],
      documentScopeId: newChatScopeId.value,
      pendingAttachments: newChatAttachments.value,
      documents: [],
      attachmentError: '',
      generationStatus: '',
      draft: '',
      isGenerating: false,
      error: ''
    })
    // 这个是把它设置为当前会话
    activeSessionId.value = id
    newChatDraft.value = ''
    newChatAttachments.value = []
    newChatAttachmentError.value = ''
    return activeSession.value
  }

  const setAttachmentError = (message) => {
    if (activeSession.value) activeSession.value.attachmentError = message
    else newChatAttachmentError.value = message
  }

  const performUpload = async (attachment, scopeId) => {
    const file = originalFiles.get(attachment.id)
    if (!file) return
    uploads.get(attachment.id)?.abort()
    const controller = new AbortController()
    uploads.set(attachment.id, controller)
    attachment.status = 'uploading'
    attachment.error = ''
    try {
      const metadata = await uploadFile({ file, scopeId, signal: controller.signal })
      if (!controller.signal.aborted) Object.assign(attachment, metadata, { id: attachment.id, fileId: metadata.id })
    } catch (error) {
      if (!controller.signal.aborted) {
        attachment.status = 'error'
        attachment.error = error.message || '上传失败，请重试'
      }
    } finally {
      if (uploads.get(attachment.id) === controller) uploads.delete(attachment.id)
    }
  }

  const removeAttachment = (id) => {
    const index = pendingAttachments.value.findIndex(file => file.id === id)
    if (index < 0) return
    uploads.get(id)?.abort()
    uploads.delete(id)
    originalFiles.delete(id)
    pendingAttachments.value.splice(index, 1)
    setAttachmentError('')
  }

  const addAttachment = async (file) => {
    if (isGenerating.value) return
    try {
      validateFile(file)
      if (referenceFile.value) throw new Error('每个会话暂支持一个文件；上传其他文件请新建聊天')
    } catch (error) { setAttachmentError(error.message); return }
  
    for (const attachment of [...pendingAttachments.value]) removeAttachment(attachment.id)
    setAttachmentError('')
    const id = crypto.randomUUID()
    pendingAttachments.value.push({ id, name: file.name, size: file.size, status: 'uploading', error: '' })
    originalFiles.set(id, file)
    // 保存发起时的对象和范围，后续切换会话也不会改变上传目标。
    const attachment = pendingAttachments.value.find(item => item.id === id)
    await performUpload(attachment, activeSession.value?.documentScopeId ?? newChatScopeId.value)
  }

  const retryAttachment = async (id) => {
    const attachment = pendingAttachments.value.find(item => item.id === id)
    if (!attachment || attachment.status !== 'error') return
    await performUpload(attachment, activeSession.value?.documentScopeId ?? newChatScopeId.value)
  }
  
  const sendMessage = async () => {
    const content = inputMessage.value.trim()
    if (!content || isGenerating.value || !canSend.value) return
     
    // 只有第一次发送有效内容才创建会话，空白聊天不会进入侧栏。
    const session = activeSession.value ?? createSession(content)
    const attachments = session.pendingAttachments.map(({ fileId, name, size, type, chunkCount }) =>
      ({ id: fileId, name, size, type, chunkCount, status: 'ready' }))
    if (attachments.length) session.documents = attachments
    for (const attachment of session.pendingAttachments) originalFiles.delete(attachment.id)
    session.pendingAttachments = []
    session.messages.push({
      id: crypto.randomUUID(),//用户消息id
      role: 'user',
      content,
      ...(attachments.length ? { attachments } : {}),
      timestamp: new Date().toLocaleString()
    })
    session.draft = ''// 输入框清空
    await requestReply(session)
  }

  const retryLastReply = async () => {
    if (!canRetryReply.value) return
    // 重试只重新请求答案，沿用附件和用户消息，不重复添加问题。
    await requestReply(activeSession.value)
  }

  const requestReply = async (session) => {
    const sessionId = session.id
    session.updatedAt = Date.now() //当前会话按最新发送时间排序
    session.isGenerating = true //输入框禁用，发送按钮显示加载状态
    session.error = '' //清除这个会话之前的错误提示
    session.generationStatus = session.documents.length ? '正在查阅文件…' : '正在思考…'
    //  这个是准备一下发送给后端的消息
    const apiMessages = session.messages
      .filter(message => message.content)
      .map(({ role, content }) => ({ role, content }))
    const replyId = crypto.randomUUID()
    // 这里还是先创建一个空的AI消息，后续收到回复之后在持续追加进去
    session.messages.push({
      id: replyId,
      role: 'assistant',
      content: '',
      sources: [],
      documentMode: '',
      timestamp: new Date().toLocaleString()
    })

    // AbortController 是浏览器提供的取消开关，每个会话拥有独立请求。
    const controller = new AbortController()
    // request是一个Map，可以这么理解这样的对应关系
    // 会话A的ID->会话A的请求控制器 会话B的ID->会话B的请求控制器
    requests.set(sessionId, controller)
    try {
      // 真正的网络请求交给streamChat，streamChat每解析出一段新增文字，就调用一次onDelta
      await streamChat({
        messages: apiMessages,
        fileIds: session.documents.map(file => file.id),
        scopeId: session.documentScopeId,
        signal: controller.signal,
        onSources: (sources, mode) => {
          const reply = session.messages.find(message => message.id === replyId)
          if (reply && !controller.signal.aborted) { reply.sources = sources; reply.documentMode = mode }
        },
        onStatus: (status) => {
          if (!controller.signal.aborted) session.generationStatus = status
        },
        onDelta: (delta) => {
          // 始终按发起请求时的 ID 更新，用户切换会话也不会串消息。
          const target = sessions.value.find(item => item.id === sessionId)
          // 根据找到的这个session对应的message来查找AI回复的消息
          const reply = target?.messages.find(message => message.id === replyId)
          if (reply && !controller.signal.aborted) reply.content += delta
        }
      })
    } catch (error) {
      if (error.name !== 'AbortError') {
        session.error = `获取 AI 回复失败：${error.message || '请检查服务后重试'}。已发送的消息仍保留在此会话中。`
      }
    } finally {
      // 请求失败或取消且没有返回文字时，移除空的 AI 占位消息。
      // 先看是否是本次ai回复，不是的话直接保存，就是避免请求失败的时候还保留之前那个占位消息
      session.messages = session.messages.filter(message => message.id !== replyId || message.content.trim())
      requests.delete(sessionId)
      session.isGenerating = false
      session.generationStatus = ''
    }
  }
  // 当聊天Store被释放时，取消它管理的所有未完成请求，再清空请求记录
  // 切换会话不会销毁 Store；只有 Store 被释放时才取消其所有请求。
  // 当执行到这里的时候，vue会先记住这个函数，等到当前作用域被停止时，才执行函数里的代码。
  onScopeDispose(() => {
    for (const controller of requests.values()) controller.abort()//发出取消请求的通知
    requests.clear() //清空请求控制器记录
    for (const controller of uploads.values()) controller.abort()
    uploads.clear()
    originalFiles.clear()
  })

  return {
    sessions, activeSessionId, activeSession, orderedSessions, storageError,
    messages, inputMessage, isGenerating, newChatDraft, draftVersion,
    newChatScopeId, newChatAttachments, newChatAttachmentError,
    pendingAttachments, referenceFile, attachmentError, canSend, generationStatus, canRetryReply,
    startNewChat, selectSession, deleteSession, sendMessage, retryLastReply, addAttachment, removeAttachment, retryAttachment, setAttachmentError
  }
}, {
  persist: {
    key: CHAT_STORAGE_KEY,
    storage: chatStorage,
    pick: ['sessions', 'activeSessionId', 'newChatDraft'],
    serializer: chatHistorySerializer
  }
})
