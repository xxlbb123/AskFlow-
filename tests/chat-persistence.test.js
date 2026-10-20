import assert from 'node:assert/strict'
import test from 'node:test'
import { createApp, nextTick } from 'vue'
import { createPinia } from 'pinia'
import piniaPluginPersistedstate from 'pinia-plugin-persistedstate'
import { useChatStore } from '../src/stores/chat.js'
import { CHAT_STORAGE_KEY, chatStorageError } from '../src/utils/chat-storage.js'

function browser(t) {
  const data = new Map()
  const localStorage = {
    getItem: key => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, value)
  }
  const original = Object.getOwnPropertyDescriptor(globalThis, 'window')
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { localStorage } })
  t.after(() => {
    if (original) Object.defineProperty(globalThis, 'window', original)
    else delete globalThis.window
    chatStorageError.value = ''
  })
  return { data, localStorage }
}

function storeFor(t) {
  const pinia = createPinia().use(piniaPluginPersistedstate)
  createApp({}).use(pinia)
  const store = useChatStore(pinia)
  t.after(() => store.$dispose())
  return store
}

const event = content => `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`
const reply = () => new Response(event('回答') + 'data: [DONE]\n\n')
function streams(t) {
  const requests = []
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    let source
    const body = new ReadableStream({ start(controller) { source = controller } })
    options.signal.addEventListener('abort', () => source.error(options.signal.reason), { once: true })
    requests.push({
      signal: options.signal,
      append: text => source.enqueue(new TextEncoder().encode(event(text))),
      finish: () => { source.enqueue(new TextEncoder().encode('data: [DONE]\n\n')); source.close() }
    })
    return new Response(body)
  })
  return requests
}
const settle = () => new Promise(resolve => setImmediate(resolve))

test('blank drafts persist without creating sidebar sessions and new-chat selection survives a reload', async t => {
  const { data } = browser(t)
  t.mock.method(globalThis, 'fetch', async () => reply())
  const store = storeFor(t)
  store.inputMessage = '未发送的草稿'
  await nextTick()
  assert.deepEqual(JSON.parse(data.get(CHAT_STORAGE_KEY)).sessions, [])
  let restored = storeFor(t)
  assert.equal(restored.inputMessage, '未发送的草稿')
  assert.equal(restored.sessions.length, 0)
  restored.inputMessage = '第一条问题'
  await restored.sendMessage()
  restored.inputMessage = '这个会话的追问草稿'
  const id = restored.activeSessionId
  restored.startNewChat()
  await nextTick()
  restored = storeFor(t)
  assert.equal(restored.activeSessionId, null)
  assert.equal(restored.sessions.length, 1)
  restored.selectSession(id)
  assert.equal(restored.inputMessage, '这个会话的追问草稿')
})

test('partial streaming replies restore as readable messages without resuming generation', async t => {
  const { data } = browser(t)
  const requests = streams(t)
  const store = storeFor(t)
  store.inputMessage = '保留部分回复'
  const pending = store.sendMessage()
  requests[0].append('已经生成的文字😀')
  await settle()
  const saved = JSON.parse(data.get(CHAT_STORAGE_KEY))
  assert.equal(saved.sessions[0].isGenerating, undefined)
  assert.equal(saved.sessions[0].generationStatus, undefined)
  store.$dispose()
  await pending
  const restored = storeFor(t)
  assert.equal(restored.activeSessionId, saved.activeSessionId)
  assert.equal(restored.messages.at(-1).content, '已经生成的文字😀')
  assert.equal(restored.isGenerating, false)
  assert.equal(restored.generationStatus, '')
  assert.equal(restored.activeSession.error, '')
  assert.equal(requests.length, 1)
})

test('an interrupted empty reply restores only the user message and remains retryable', async t => {
  browser(t)
  const requests = streams(t)
  const store = storeFor(t)
  store.inputMessage = '刷新前还未收到回答'
  const pending = store.sendMessage()
  await nextTick()
  store.$dispose()
  await pending
  const restored = storeFor(t)
  assert.equal(restored.messages.length, 1)
  assert.equal(restored.canRetryReply, true)
  assert.equal(requests[0].signal.aborted, true)
})

test('deleting a generating session cancels its request and keeps another session active across reloads', async t => {
  browser(t)
  const requests = streams(t)
  const store = storeFor(t)
  store.inputMessage = '会话 A'
  const first = store.sendMessage()
  const idA = store.activeSessionId
  store.startNewChat()
  store.inputMessage = '会话 B'
  const second = store.sendMessage()
  const idB = store.activeSessionId
  store.deleteSession(idA)
  await first
  assert.equal(requests[0].signal.aborted, true)
  assert.equal(requests[1].signal.aborted, false)
  assert.equal(store.activeSessionId, idB)
  requests[1].append('B 的回复')
  requests[1].finish()
  await second
  await nextTick()
  store.$dispose()
  const restored = storeFor(t)
  assert.deepEqual(restored.sessions.map(session => session.id), [idB])
  assert.equal(restored.messages.at(-1).content, 'B 的回复')
  restored.deleteSession(idB)
  await nextTick()
  restored.$dispose()
  const empty = storeFor(t)
  assert.equal(empty.sessions.length, 0)
  assert.equal(empty.activeSessionId, null)
})

test('ready pending attachments and their scope restore and can be sent without the original File object', async t => {
  browser(t)
  const payloads = []
  const fileId = crypto.randomUUID()
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (url.includes('/api/files')) return Response.json({ file: { id: fileId, name: '规则.md', size: 40, type: 'md', chunkCount: 2, status: 'ready' } })
    payloads.push(JSON.parse(options.body))
    return reply()
  })
  const store = storeFor(t)
  store.inputMessage = '已有会话'
  await store.sendMessage()
  await store.addAttachment(new File(['# 规则'], '规则.md'))
  const scopeId = store.activeSession.documentScopeId
  await nextTick()
  store.$dispose()
  const restored = storeFor(t)
  assert.equal(restored.pendingAttachments[0].fileId, fileId)
  assert.equal(restored.canSend, true)
  restored.inputMessage = '根据附件继续提问'
  await restored.sendMessage()
  assert.deepEqual(payloads.at(-1).fileIds, [fileId])
  assert.equal(payloads.at(-1).scopeId, scopeId)
  assert.equal(restored.referenceFile.id, fileId)
})

test('deleting a session cancels its pending upload and never restores the deleted conversation', async t => {
  browser(t)
  let uploadSignal
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (!url.includes('/api/files')) return reply()
    uploadSignal = options.signal
    return new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true }))
  })
  const store = storeFor(t)
  store.inputMessage = '删除带上传的会话'
  await store.sendMessage()
  const uploading = store.addAttachment(new File(['资料'], '资料.txt'))
  store.deleteSession(store.activeSessionId)
  await uploading
  await nextTick()
  assert.equal(uploadSignal.aborted, true)
  assert.equal(store.attachmentError, '')
  assert.equal(storeFor(t).sessions.length, 0)
})

test('corrupt storage and invalid session selection do not crash the chat', async t => {
  const { data } = browser(t)
  data.set(CHAT_STORAGE_KEY, '{bad json')
  let store = storeFor(t)
  assert.equal(store.sessions.length, 0)
  assert.match(store.storageError, /格式损坏/)
  data.set(CHAT_STORAGE_KEY, JSON.stringify({ version: 1, sessions: [null, { id: 1, messages: 'bad' }], activeSessionId: 'missing' }))
  store = storeFor(t)
  assert.equal(store.activeSessionId, null)
  assert.equal(store.sessions.length, 0)
})

test('blocked or full storage reports the failure while chat works, and deletion can recover saving', async t => {
  const { localStorage } = browser(t)
  let full = true
  const originalSet = localStorage.setItem
  localStorage.setItem = (key, value) => {
    if (full) throw new DOMException('Full', 'QuotaExceededError')
    originalSet(key, value)
  }
  t.mock.method(globalThis, 'fetch', async () => reply())
  const store = storeFor(t)
  store.inputMessage = '存储失败仍可聊天'
  await store.sendMessage()
  await nextTick()
  assert.equal(store.messages.at(-1).content, '回答')
  assert.match(store.storageError, /空间不足/)
  full = false
  store.deleteSession(store.activeSessionId)
  await nextTick()
  assert.equal(store.storageError, '')
  localStorage.getItem = () => { throw new Error('Blocked') }
  const blocked = storeFor(t)
  assert.equal(blocked.sessions.length, 0)
  assert.match(blocked.storageError, /无法读取/)
})
