import { ref } from 'vue'

export const CHAT_STORAGE_KEY = 'ai-chat-history-v1'
export const chatStorageError = ref('')

const emptyHistory = () => ({ sessions: [], activeSessionId: null, newChatDraft: '' })
const isId = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
const getStorage = () => typeof window === 'undefined' ? null : window.localStorage

function fileData(file, pending = false) {
  if (!file || !isId(file.id) || (pending && !isId(file.fileId))) return null
  return {
    id: file.id,
    ...(pending ? { fileId: file.fileId } : {}),
    name: typeof file.name === 'string' ? file.name : '附件',
    size: Number.isFinite(file.size) ? file.size : 0,
    type: file.type === 'txt' ? 'txt' : 'md',
    chunkCount: Number.isFinite(file.chunkCount) ? file.chunkCount : 0,
    status: 'ready'
  }
}

// 只保存普通数据；生成状态、错误、上传中的 File 和请求控制器不属于历史记录。
function sessionData(session) {
  if (!session || !isId(session.id) || !Array.isArray(session.messages)) return null
  const messages = session.messages
    .filter(message => message && isId(message.id) && ['user', 'assistant'].includes(message.role)
      && typeof message.content === 'string' && message.content.trim())
    .map(message => ({
      id: message.id,
      role: message.role,
      content: message.content,
      timestamp: typeof message.timestamp === 'string' ? message.timestamp : '',
      ...(message.role === 'user' ? {
        attachments: (Array.isArray(message.attachments) ? message.attachments : []).map(file => fileData(file)).filter(Boolean)
      } : {
        sources: (Array.isArray(message.sources) ? message.sources : []).filter(source => source
          && Number.isInteger(source.index) && source.index > 0 && typeof source.text === 'string'),
        documentMode: ['full', 'retrieval'].includes(message.documentMode) ? message.documentMode : ''
      })
    }))
  if (!messages.length) return null
  const hasScope = isId(session.documentScopeId)
  return {
    id: session.id,
    title: typeof session.title === 'string' && session.title.trim() ? session.title : '聊天记录',
    createdAt: Number.isFinite(session.createdAt) ? session.createdAt : Date.now(),
    updatedAt: Number.isFinite(session.updatedAt) ? session.updatedAt : Date.now(),
    messages,
    draft: typeof session.draft === 'string' ? session.draft : '',
    documentScopeId: hasScope ? session.documentScopeId : crypto.randomUUID(),
    documents: hasScope && Array.isArray(session.documents) ? session.documents.map(file => fileData(file)).filter(Boolean) : [],
    pendingAttachments: hasScope && Array.isArray(session.pendingAttachments)
      ? session.pendingAttachments.filter(file => file?.status === 'ready').map(file => fileData(file, true)).filter(Boolean) : []
  }
}

function restoreHistory(raw) {
  const data = JSON.parse(raw)
  if (data?.version !== 1 || !Array.isArray(data.sessions)) throw new Error('聊天记录格式无效')
  const sessions = data.sessions.map(sessionData).filter(Boolean).map(session => ({
    ...session, isGenerating: false, generationStatus: '', error: '', attachmentError: ''
  }))
  return {
    sessions,
    activeSessionId: sessions.some(session => session.id === data.activeSessionId) ? data.activeSessionId : null,
    newChatDraft: typeof data.newChatDraft === 'string' ? data.newChatDraft : ''
  }
}

// 插件使用这个同步存储接口；存储失败时提示用户，聊天仍可在内存中继续。
export const chatStorage = {
  getItem(key) {
    try {
      const value = getStorage()?.getItem(key) ?? null
      chatStorageError.value = ''
      return value
    } catch {
      chatStorageError.value = '无法读取本地聊天记录，请检查浏览器的网站存储设置。'
      return null
    }
  },
  setItem(key, value) {
    try {
      getStorage()?.setItem(key, value)
      chatStorageError.value = ''
    } catch (error) {
      chatStorageError.value = error.name === 'QuotaExceededError'
        ? '本地聊天记录存储空间不足，请删除不需要的会话。当前聊天仍可继续。'
        : '无法保存聊天记录，请检查浏览器的网站存储设置。当前聊天仍可继续。'
    }
  }
}

export const chatHistorySerializer = {
  serialize({ sessions, activeSessionId, newChatDraft }) {
    return JSON.stringify({
      version: 1,
      sessions: sessions.map(sessionData).filter(Boolean),
      activeSessionId,
      newChatDraft
    })
  },
  deserialize(raw) {
    try {
      return restoreHistory(raw)
    } catch {
      chatStorageError.value = '本地聊天记录格式损坏，暂时无法恢复。你仍可以新建聊天。'
      return emptyHistory()
    }
  }
}
