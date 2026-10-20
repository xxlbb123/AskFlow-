import assert from 'node:assert/strict'
import test from 'node:test'
import http from 'node:http'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { createPinia } from 'pinia'
import { createApp as createVueApp, nextTick } from 'vue'
import piniaPluginPersistedstate from 'pinia-plugin-persistedstate'
import { useChatStore } from '../src/stores/chat.js'

const require = createRequire(import.meta.url)
const { createApp } = require('../backend/src/app.js')
const { createConfig } = require('../backend/src/config/env.js')
const { fixtureEmbedding } = require('../backend/tests/helpers/embedding.js')

test('actual HTTP connects persisted frontend sessions, uploads, MCP sources and follow-up answers after reload', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'yuan-chat-integration-'))
  const payloads = []
  const embeddingPayloads = []
  let blankNext = false
  let supplementNext = false
  let multipleQuestions = false
  const config = { ...createConfig({ ARK_API_KEY: 'fake', ARK_MODEL_ID: 'fake' }), documentStorageDir: directory }
  const app = createApp({ config, fetchImpl: async (url, options) => {
    const payload = JSON.parse(options.body)
    if (url.endsWith('/embeddings/multimodal')) {
      embeddingPayloads.push(payload)
      return Response.json({ data: { embedding: fixtureEmbedding(payload.input[0].text, {
        role: payload.instructions.startsWith('Instruction:Compress') ? 'corpus' : 'query',
        dimensions: payload.dimensions
      }) } })
    }
    payloads.push(payload)
    if (!payload.stream) {
      const fileId = payload.tools[0].function.parameters.properties.fileId.enum[0]
      const isFollowUp = payload.messages.at(-1).role === 'tool'
      if (isFollowUp && !supplementNext) return Response.json({ choices: [{ message: { role: 'assistant', content: '资料已足够。' } }] })
      const queries = isFollowUp ? ['空白草稿为何不显示'] : ['保存会话 第一条消息']
      if (isFollowUp) supplementNext = false
      return Response.json({ choices: [{ message: { role: 'assistant', content: null, tool_calls: [{
        id: isFollowUp ? 'supplement' : 'search', type: 'function', function: { name: 'searchDocuments', arguments: JSON.stringify({ fileId, queries }) }
      }] } }] })
    }
    assert.equal(payload.tools, undefined)
    assert.match(payload.messages.map(message => message.content ?? '').join('\n'), /第一条有效消息/)
    if (blankNext) {
      blankNext = false
      return new Response('data: {"choices":[{"delta":{"reasoning_content":"只有思考内容","content":""},"finish_reason":"length"}]}\n\ndata: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } })
    }
    const answer = multipleQuestions ? '发送第一条有效消息后保存会话；空白草稿不会进入侧栏。[1]' : '发送第一条有效消息后保存会话。[1]'
    return new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: answer } }] })}\n\ndata: [DONE]\n\n`, { headers: { 'Content-Type': 'text/event-stream' } })
  } })
  const server = http.createServer(app)
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}`
  const realFetch = globalThis.fetch
  t.mock.method(globalThis, 'fetch', (url, options) => realFetch(url.replace('http://localhost:3000', base), options))
  const storage = new Map()
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { localStorage: {
    getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value)
  } } })
  const restoreStore = () => {
    const pinia = createPinia().use(piniaPluginPersistedstate)
    createVueApp({}).use(pinia)
    return useChatStore(pinia)
  }
  let store = restoreStore()
  t.after(async () => {
    store.$dispose()
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()))
    assert.ok(path.basename(directory).startsWith('yuan-chat-integration-'))
    await fs.rm(directory, { recursive: true, force: true })
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow)
    else delete globalThis.window
  })
  await store.addAttachment(new File(['# 会话规则\n\n发送第一条有效消息后才保存会话，空白草稿不进侧栏。'], '规则.md'))
  assert.equal(store.pendingAttachments[0].status, 'ready')
  assert.equal(payloads.length, 0)
  assert.equal(embeddingPayloads.length, 1)
  assert.equal(embeddingPayloads[0].model, 'doubao-embedding-vision-251215')
  assert.equal(store.sessions.length, 0)
  store.inputMessage = '什么时候保存会话？'
  await store.sendMessage()
  assert.equal(store.activeSession.error, '')
  assert.equal(store.messages.at(-1).content, '发送第一条有效消息后保存会话。[1]')
  assert.equal(store.messages.at(-1).sources[0].startLine, 1)
  assert.equal(store.messages.at(-1).sources[0].endLine, 3)
  assert.equal(store.messages.at(-1).documentMode, 'full')
  assert.equal(store.messages[0].attachments[0].name, '规则.md')
  const savedSessionId = store.activeSessionId
  const savedFileId = store.referenceFile.id
  const savedScopeId = store.activeSession.documentScopeId
  await nextTick()
  store.$dispose()
  store = restoreStore()
  assert.equal(store.activeSessionId, savedSessionId)
  assert.equal(store.referenceFile.id, savedFileId)
  assert.equal(store.activeSession.documentScopeId, savedScopeId)
  assert.equal(store.messages.at(-1).sources[0].endLine, 3)
  assert.equal(store.messages.at(-1).documentMode, 'full')
  store.inputMessage = '空白草稿也保存吗？'
  await store.sendMessage()
  assert.equal(store.activeSession.error, '')
  assert.equal(store.sessions.length, 1)
  assert.equal(store.messages.length, 4)
  assert.equal(payloads.length, 4)
  assert.equal(payloads[2].messages.filter(message => message.role === 'user').length, 2)
  assert.deepEqual(payloads[2].tools[0].function.parameters.properties.fileId.enum, [savedFileId])
  // 重现“已检索并显示正在回复，但流结束时没有正文”的实际链路。
  t.mock.method(console, 'warn', () => {})
  blankNext = true
  store.inputMessage = '这次回复失败后重试'
  await store.sendMessage()
  const failedUserId = store.messages.at(-1).id
  const fileId = store.referenceFile.id
  assert.equal(store.messages.length, 5)
  assert.match(store.activeSession.error, /没有生成回复正文/)
  assert.equal(store.canRetryReply, true)
  await store.retryLastReply()
  assert.equal(store.messages.length, 6)
  assert.equal(store.messages.at(-2).id, failedUserId)
  assert.equal(store.referenceFile.id, fileId)
  assert.equal(store.activeSession.error, '')
  assert.equal(store.messages.at(-1).sources[0].endLine, 3)
  assert.equal(payloads.length, 8)
  assert.deepEqual(payloads[4].messages, payloads[6].messages)
  assert.deepEqual(payloads[4].tools, payloads[6].tools)
  store.startNewChat()
  await store.addAttachment(new File(['# 会话规则\n\n发送第一条有效消息后才保存会话。\n\n# 无关资料\n'
    + ('天气晴朗，可以出去散步。'.repeat(25) + '\n\n').repeat(80)
    + '# 空白草稿\n\n空白草稿没有发送消息，因此不进入侧栏。'], '长规则.md'))
  supplementNext = true
  multipleQuestions = true
  store.inputMessage = '什么时候保存会话？空白草稿为何不显示？'
  await store.sendMessage()
  assert.equal(payloads.length, 12)
  assert.equal(payloads.at(-1).messages.at(-1).role, 'user')
  assert.match(payloads.at(-1).messages[0].content, /空白草稿没有发送消息/)
  assert.equal(store.activeSession.error, '')
  assert.equal(store.isGenerating, false)
  assert.equal(store.messages.length, 2)
  assert.match(store.messages.at(-1).content, /空白草稿不会进入侧栏/)
  assert.ok(store.messages.at(-1).sources.length >= 2)
  assert.equal(new Set(store.messages.at(-1).sources.map(source => source.chunkId)).size, store.messages.at(-1).sources.length)
  assert.equal(store.messages.at(-1).sources[1].index, 2)
})
