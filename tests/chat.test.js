import assert from 'node:assert/strict'
import test from 'node:test'
import { createPinia } from 'pinia'
import { useChatStore } from '../src/stores/chat.js'
import { streamChat } from '../src/services/chat.js'

const encoder = new TextEncoder()
const dataLine = content => `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`
const settle = () => new Promise(resolve => setImmediate(resolve))

function createStore(t) {
  const store = useChatStore(createPinia())
  t.after(() => store.$dispose())
  return store
}

function mockRequests(t) {
  const requests = []
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    let source
    const body = new ReadableStream({ start(controller) { source = controller } })
    options.signal?.addEventListener('abort', () => source.error(options.signal.reason), { once: true })
    requests.push({
      url,
      payload: JSON.parse(options.body),
      signal: options.signal,
      append: content => source.enqueue(encoder.encode(dataLine(content))),
      finish: () => {
        source.enqueue(encoder.encode('data: [DONE]\n\n'))
        source.close()
      }
    })
    return new Response(body)
  })
  return requests
}

test('new chats and whitespace never create sidebar sessions or requests', async t => {
  const requests = mockRequests(t)
  const store = createStore(t)
  for (let index = 0; index < 3; index++) store.startNewChat()
  store.inputMessage = ' \n '
  await store.sendMessage()
  assert.equal(store.activeSessionId, null)
  assert.deepEqual(store.sessions, [])
  assert.equal(requests.length, 0)
})

test('the first send creates a titled session immediately and blocks duplicate sends', async t => {
  const requests = mockRequests(t)
  const store = createStore(t)
  store.inputMessage = '  Explain\n Vue  '
  const pending = store.sendMessage()
  const id = store.activeSessionId
  assert.equal(store.sessions.length, 1)
  assert.equal(store.activeSession.title, 'Explain Vue')
  assert.equal(store.inputMessage, '')
  assert.equal(store.isGenerating, true)
  assert.equal(requests.length, 1)
  assert.deepEqual(requests[0].payload.messages, [{ role: 'user', content: 'Explain\n Vue' }])
  store.inputMessage = 'Do not send twice'
  await store.sendMessage()
  assert.equal(requests.length, 1)
  requests[0].append('Vue is reactive.')
  requests[0].finish()
  await pending
  assert.equal(store.activeSessionId, id)
  assert.equal(store.messages.at(-1).content, 'Vue is reactive.')
  assert.equal(store.isGenerating, false)
})

test('concurrent streams stay with their original sessions when switching or starting a draft', async t => {
  const requests = mockRequests(t)
  const store = createStore(t)
  store.inputMessage = 'Question A'
  const pendingA = store.sendMessage()
  const idA = store.activeSessionId
  requests[0].append('Answer A part 1. ')
  await settle()

  store.startNewChat()
  assert.equal(store.sessions.length, 1)
  assert.equal(store.messages.length, 0)
  assert.equal(store.isGenerating, false)
  store.inputMessage = 'Question B'
  const pendingB = store.sendMessage()
  const idB = store.activeSessionId
  assert.notEqual(idA, idB)
  store.selectSession(idA)
  assert.equal(store.messages.at(-1).content, 'Answer A part 1. ')
  assert.equal(store.isGenerating, true)

  requests[1].append('Answer B.')
  requests[1].finish()
  await pendingB
  assert.equal(store.activeSessionId, idA)
  assert.equal(store.isGenerating, true)
  assert.equal(store.messages.at(-1).content, 'Answer A part 1. ')

  store.startNewChat()
  requests[0].append('Part 2.')
  requests[0].finish()
  await pendingA
  assert.equal(store.activeSessionId, null)
  assert.equal(store.messages.length, 0)
  store.selectSession(idA)
  assert.equal(store.messages.at(-1).content, 'Answer A part 1. Part 2.')
  store.selectSession(idB)
  assert.equal(store.messages.at(-1).content, 'Answer B.')
  assert.equal(store.sessions.length, 2)
})

test('follow-ups reuse the session and send only its own history', async t => {
  const requests = mockRequests(t)
  const store = createStore(t)
  store.inputMessage = 'First question'
  let pending = store.sendMessage()
  const id = store.activeSessionId
  requests[0].append('First answer')
  requests[0].finish()
  await pending
  store.inputMessage = 'Follow-up'
  pending = store.sendMessage()
  assert.equal(store.activeSessionId, id)
  assert.equal(store.sessions.length, 1)
  assert.equal(store.activeSession.title, 'First question')
  assert.deepEqual(requests[1].payload.messages, [
    { role: 'user', content: 'First question' },
    { role: 'assistant', content: 'First answer' },
    { role: 'user', content: 'Follow-up' }
  ])
  requests[1].finish()
  await pending
})

test('drafts stay with their sessions and invalid selections are ignored', async t => {
  const requests = mockRequests(t)
  const store = createStore(t)
  store.inputMessage = 'Saved session'
  const pending = store.sendMessage()
  const id = store.activeSessionId
  requests[0].finish()
  await pending
  store.inputMessage = 'Unsent follow-up'
  store.startNewChat()
  store.inputMessage = 'Unsent new question'
  store.selectSession(id)
  assert.equal(store.inputMessage, 'Unsent follow-up')
  store.selectSession('missing')
  assert.equal(store.activeSessionId, id)
  store.startNewChat()
  assert.equal(store.inputMessage, '')
  assert.equal(store.sessions.length, 1)
})

test('titles truncate by Unicode characters and keep the complete user message', async t => {
  const requests = mockRequests(t)
  const store = createStore(t)
  const question = '🧠'.repeat(26)
  store.inputMessage = question
  const pending = store.sendMessage()
  assert.equal(store.activeSession.title, '🧠'.repeat(24) + '…')
  assert.equal(store.messages[0].content, question)
  requests[0].finish()
  await pending
})

test('request failures retain the session and user message and allow another send', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response('Unavailable', { status: 503 }))
  const store = createStore(t)
  store.inputMessage = 'Keep this question'
  await store.sendMessage()
  const id = store.activeSessionId
  assert.equal(store.sessions.length, 1)
  assert.equal(store.messages.length, 1)
  assert.equal(store.messages[0].role, 'user')
  assert.ok(store.activeSession.error)
  assert.equal(store.isGenerating, false)
  store.inputMessage = 'Another try'
  await store.sendMessage()
  assert.equal(store.activeSessionId, id)
  assert.equal(store.messages.length, 2)
})

test('disposing the store aborts pending requests without reporting a request failure', async t => {
  const requests = mockRequests(t)
  const store = createStore(t)
  store.inputMessage = 'Cancel on disposal'
  const pending = store.sendMessage()
  await settle()
  store.$dispose()
  await pending
  assert.equal(requests[0].signal.aborted, true)
  assert.equal(store.isGenerating, false)
  assert.equal(store.sessions[0].error, '')
})

test('stream parser handles split UTF-8, split JSON, CRLF and a final line without newline', async t => {
  const bytes = encoder.encode(dataLine('你好').replaceAll('\n', '\r\n') + dataLine('，Vue！') + 'data: [DONE]')
  const body = new ReadableStream({
    start(controller) {
      for (const byte of bytes) controller.enqueue(new Uint8Array([byte]))
      controller.close()
    }
  })
  t.mock.method(globalThis, 'fetch', async () => new Response(body))
  let reply = ''
  await streamChat({ messages: [], onDelta: delta => { reply += delta } })
  assert.equal(reply, '你好，Vue！')
  assert.equal(body.locked, false)
})

test('DONE stops reading and cancels unread data even before the network closes', async t => {
  let cancelled = false
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(dataLine('Expected') + 'data: [DONE]\n\n' + dataLine('Ignored')))
    },
    cancel() { cancelled = true }
  })
  t.mock.method(globalThis, 'fetch', async () => new Response(body))
  let reply = ''
  await streamChat({ messages: [], onDelta: delta => { reply += delta } })
  assert.equal(reply, 'Expected')
  assert.equal(cancelled, true)
  assert.equal(body.locked, false)
})

test('stream errors reject and release their reader', async t => {
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode('data: {"error":{"message":"model unavailable"}}\n\n'))
      controller.close()
    }
  })
  t.mock.method(globalThis, 'fetch', async () => new Response(body))
  await assert.rejects(streamChat({ messages: [], onDelta() {} }), /model unavailable/)
  assert.equal(body.locked, false)
})

test('a response without a body is rejected', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response(null, { status: 204 }))
  await assert.rejects(streamChat({ messages: [], onDelta() {} }))
})

test('HTTP model errors expose the endpoint failure to the page', async t => {
  const payload = { error: { code: 'InvalidEndpoint.ClosedEndpoint', message: 'Endpoint closed' } }
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify(payload), { status: 400 }))
  const store = createStore(t)
  store.inputMessage = 'Keep my question'
  await store.sendMessage()
  assert.match(store.activeSession.error, /模型接入点已关闭或暂时不可用/)
  assert.equal(store.messages.length, 1)
  assert.equal(store.messages[0].content, 'Keep my question')
  assert.equal(store.isGenerating, false)
})

test('JSON errors disguised as SSE cannot silently become empty replies', async t => {
  const bytes = encoder.encode(JSON.stringify({ error: { code: 'InvalidEndpoint.ClosedEndpoint', message: 'Endpoint closed' } }, null, 2))
  const body = new ReadableStream({
    start(controller) {
      for (const byte of bytes) controller.enqueue(new Uint8Array([byte]))
      controller.close()
    }
  })
  t.mock.method(globalThis, 'fetch', async () => new Response(body, { headers: { 'Content-Type': 'text/event-stream' } }))
  await assert.rejects(streamChat({ messages: [], onDelta() { assert.fail('An error must not create reply text') } }), /模型接入点已关闭或暂时不可用/)
  assert.equal(body.locked, false)
})

test('SSE endpoint errors use the same readable failure message', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response('data: {"error":{"code":"InvalidEndpoint.ClosedEndpoint","message":"Endpoint closed"}}\n\n'))
  await assert.rejects(streamChat({ messages: [], onDelta() {} }), /模型接入点已关闭或暂时不可用/)
})

test('an empty or non-stream response is reported as a failure', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response(''))
  await assert.rejects(streamChat({ messages: [], onDelta() {} }), /没有返回有效的流式响应/)
})

test('status/source-only streams ending in DONE are not successful answers', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response('data: {"type":"sources","sources":[]}\n\ndata: {"type":"status","message":"正在生成回复…"}\n\ndata: [DONE]\n\n'))
  const store = createStore(t)
  store.inputMessage = '请根据附件回答'
  await store.sendMessage()
  assert.equal(store.isGenerating, false)
  assert.equal(store.messages.length, 1)
  assert.match(store.activeSession.error, /没有返回回复正文/)
  assert.equal(store.canRetryReply, true)
})

test('reasoning-only and whitespace-only streams are not displayed as answers', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response('data: {"choices":[{"delta":{"reasoning_content":"不应展示的思考内容","content":" \\n "},"finish_reason":"length"}]}\n\ndata: [DONE]\n\n'))
  const store = createStore(t)
  store.inputMessage = '问题'
  await store.sendMessage()
  assert.equal(store.messages.length, 1)
  assert.match(store.activeSession.error, /没有生成回复正文/)
  assert.equal(store.isGenerating, false)
})

test('a partial response is retained while output truncation and premature connection closure are reported', async t => {
  let suffix = 'data: {"choices":[{"delta":{},"finish_reason":"length"}]}\n\ndata: [DONE]\n\n'
  t.mock.method(globalThis, 'fetch', async () => new Response(dataLine('部分正文') + suffix))
  const store = createStore(t)
  store.inputMessage = '问题'
  await store.sendMessage()
  assert.equal(store.messages.at(-1).content, '部分正文')
  assert.match(store.activeSession.error, /输出长度上限/)
  suffix = ''
  store.inputMessage = '继续'
  await store.sendMessage()
  assert.equal(store.messages.at(-1).content, '部分正文')
  assert.match(store.activeSession.error, /连接提前结束/)
  assert.equal(store.isGenerating, false)
})

test('retrying an empty response reuses the original question without duplicate messages and blocks duplicate retries', async t => {
  const requests = mockRequests(t)
  const store = createStore(t)
  store.inputMessage = '需要重试的问题'
  let pending = store.sendMessage()
  const userId = store.messages[0].id
  const sessionId = store.activeSessionId
  requests[0].finish()
  await pending
  assert.equal(store.canRetryReply, true)
  pending = store.retryLastReply()
  await store.retryLastReply()
  assert.equal(requests.length, 2)
  assert.deepEqual(requests[1].payload.messages, [{ role: 'user', content: '需要重试的问题' }])
  requests[1].append('重试成功的回答')
  requests[1].finish()
  await pending
  assert.equal(store.activeSessionId, sessionId)
  assert.equal(store.messages[0].id, userId)
  assert.equal(store.messages.length, 2)
  assert.equal(store.messages.at(-1).content, '重试成功的回答')
  assert.equal(store.activeSession.error, '')
  assert.equal(store.canRetryReply, false)
})
