import assert from 'node:assert/strict'
import test from 'node:test'
import { createPinia } from 'pinia'
import { useChatStore } from '../src/stores/chat.js'
import { streamChat } from '../src/services/chat.js'
import { validateFile, FILE_MAX_BYTES, FILE_UPLOAD_TIMEOUT_MS } from '../src/services/files.js'

const file = (name = '说明.md') => new File(['# 规则\n第一条消息后保存会话。'], name, { type: 'text/markdown' })
const metadata = name => ({ id: crypto.randomUUID(), name, size: 48, type: 'md', chunkCount: 2, status: 'ready' })
const storeFor = t => {
  const store = useChatStore(createPinia())
  t.after(() => store.$dispose())
  return store
}
function network(t) {
  const uploads = []
  const chats = []
  t.mock.method(globalThis, 'fetch', (url, options) => {
    if (url.includes('/api/files')) return new Promise((resolve, reject) => {
      const entry = { url, options, succeed: value => resolve(Response.json({ file: value })), fail: () => resolve(Response.json({ error: { message: '解析失败' } }, { status: 400 })) }
      uploads.push(entry)
      options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true })
    })
    chats.push(JSON.parse(options.body))
    return Promise.resolve(new Response('data: {"choices":[{"delta":{"content":"回答"}}]}\n\ndata: [DONE]\n\n'))
  })
  return { uploads, chats }
}

test('file validation blocks unsupported, empty and oversized attachments without creating a session', async t => {
  assert.throws(() => validateFile(new File([], 'a.txt')), /为空/)
  assert.throws(() => validateFile({ name: 'large.txt', size: FILE_MAX_BYTES + 1 }), /2 MB/)
  const { uploads } = network(t)
  const store = storeFor(t)
  await store.addAttachment(file('a.pdf'))
  assert.match(store.attachmentError, /TXT/)
  assert.equal(uploads.length, 0)
  assert.equal(store.sessions.length, 0)
});

test('upload blocks sends until ready, then first question links the attachment and follow-ups reuse its scope', async t => {
  const { uploads, chats } = network(t)
  const store = storeFor(t)
  store.inputMessage = '什么时候保存会话？'
  const pending = store.addAttachment(file())
  assert.equal(store.canSend, false)
  assert.equal(store.sessions.length, 0)
  await store.sendMessage()
  assert.equal(chats.length, 0)
  const saved = metadata('说明.md')
  const uploadScope = new URL(uploads[0].url).searchParams.get('scopeId')
  assert.equal(uploads[0].options.headers['Content-Type'], 'application/octet-stream')
  assert.ok(uploads[0].options.body instanceof File)
  uploads[0].succeed(saved)
  await pending
  assert.equal(store.canSend, true)
  assert.equal(store.sessions.length, 0)
  await store.sendMessage()
  assert.equal(store.sessions.length, 1)
  assert.equal(store.messages[0].attachments[0].id, saved.id)
  assert.equal(store.referenceFile.id, saved.id)
  assert.deepEqual(store.pendingAttachments, [])
  assert.deepEqual(chats[0].fileIds, [saved.id])
  assert.equal(chats[0].scopeId, uploadScope)
  assert.equal(JSON.stringify(chats[0]).includes('# 规则'), false)
  store.inputMessage = '那空白草稿呢？'
  await store.sendMessage()
  assert.deepEqual(chats[1].fileIds, [saved.id])
  assert.equal(chats[1].scopeId, uploadScope)
  assert.equal(chats[1].messages.length, 3)
  await store.addAttachment(file('其他.md'))
  assert.match(store.attachmentError, /新建聊天/)
  assert.equal(uploads.length, 1)
});

test('removal and a new blank chat cancel an upload; its late result cannot attach to the new draft', async t => {
  const { uploads } = network(t)
  const store = storeFor(t)
  const first = store.addAttachment(file())
  store.removeAttachment(store.pendingAttachments[0].id)
  await first
  assert.equal(uploads[0].options.signal.aborted, true)
  assert.deepEqual(store.pendingAttachments, [])
  const second = store.addAttachment(file())
  store.startNewChat()
  uploads[1].succeed(metadata('说明.md'))
  await second
  assert.equal(uploads[1].options.signal.aborted, true)
  assert.deepEqual(store.pendingAttachments, [])
  assert.equal(store.sessions.length, 0)
});

test('failed uploads are retryable and removal unblocks sending', async t => {
  const { uploads, chats } = network(t)
  const store = storeFor(t)
  let pending = store.addAttachment(file())
  const localId = store.pendingAttachments[0].id
  uploads[0].fail()
  await pending
  assert.equal(store.pendingAttachments[0].status, 'error')
  assert.match(store.pendingAttachments[0].error, /解析失败/)
  store.inputMessage = '问题'
  await store.sendMessage()
  assert.equal(chats.length, 0)
  pending = store.retryAttachment(localId)
  uploads[1].succeed(metadata('说明.md'))
  await pending
  assert.equal(store.pendingAttachments[0].id, localId)
  assert.equal(store.pendingAttachments[0].status, 'ready')
  store.removeAttachment(localId)
  await store.sendMessage()
  assert.equal(chats.length, 1)
  assert.equal(chats[0].fileIds, undefined)
});

test('an upload completing after switching sessions only updates the original session draft', async t => {
  const { uploads } = network(t)
  const store = storeFor(t)
  store.inputMessage = 'A'
  await store.sendMessage()
  const idA = store.activeSessionId
  store.startNewChat()
  store.inputMessage = 'B'
  await store.sendMessage()
  const idB = store.activeSessionId
  store.selectSession(idA)
  const pending = store.addAttachment(file())
  store.selectSession(idB)
  uploads[0].succeed(metadata('说明.md'))
  await pending
  assert.equal(store.activeSessionId, idB)
  assert.deepEqual(store.pendingAttachments, [])
  store.selectSession(idA)
  assert.equal(store.pendingAttachments[0].status, 'ready')
});

test('disposing a store cancels pending file uploads', async t => {
  const { uploads } = network(t)
  const store = storeFor(t)
  const pending = store.addAttachment(file())
  store.$dispose()
  await pending
  assert.equal(uploads[0].options.signal.aborted, true)
});

test('upload timeouts show a retryable error instead of leaving the composer permanently blocked', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const { uploads } = network(t)
  const store = storeFor(t)
  const pending = store.addAttachment(file())
  t.mock.timers.tick(FILE_UPLOAD_TIMEOUT_MS)
  await pending
  assert.equal(uploads[0].options.signal.aborted, true)
  assert.equal(store.pendingAttachments[0].status, 'error')
  assert.match(store.pendingAttachments[0].error, /超时/)
  const retry = store.retryAttachment(store.pendingAttachments[0].id)
  uploads[1].succeed(metadata('说明.md'))
  await retry
  assert.equal(store.canSend, true)
});

test('network failures expose a readable upload error and retain the original file for retry', async t => {
  t.mock.method(globalThis, 'fetch', async () => { throw new TypeError('Failed to fetch') })
  const store = storeFor(t)
  await store.addAttachment(file())
  assert.equal(store.pendingAttachments[0].status, 'error')
  assert.match(store.pendingAttachments[0].error, /后端是否启动/)
});

test('an upload endpoint missing from a stale backend shows a restart hint', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response('', { status: 404 }))
  const store = storeFor(t)
  await store.addAttachment(file())
  assert.equal(store.pendingAttachments[0].status, 'error')
  assert.match(store.pendingAttachments[0].error, /重启后端/)
  assert.match(store.pendingAttachments[0].error, /HTTP 404/)
});

test('split source/status SSE events are parsed separately from answer text', async t => {
  const sources = [{ index: 1, fileId: 'file', chunkId: 'chunk', name: '说明.md', text: '原文', startLine: 3, endLine: 3 }]
  const data = `data: ${JSON.stringify({ type: 'sources', sources, mode: 'retrieval' })}\n\ndata: {"type":"status","message":"正在生成回复…"}\n\ndata: {"choices":[{"delta":{"content":"回答[1]"}}]}\n\ndata: [DONE]\n\n`
  t.mock.method(globalThis, 'fetch', async () => new Response(new ReadableStream({ start(controller) {
    for (const byte of new TextEncoder().encode(data)) controller.enqueue(Uint8Array.of(byte))
    controller.close()
  } })))
  const received = []
  await streamChat({ messages: [{ role: 'user', content: '问题' }], onDelta: value => received.push(['text', value]),
    onSources: (value, mode) => received.push(['sources', value, mode]), onStatus: value => received.push(['status', value]) })
  assert.deepEqual(received, [['sources', sources, 'retrieval'], ['status', '正在生成回复…'], ['text', '回答[1]']])
});
