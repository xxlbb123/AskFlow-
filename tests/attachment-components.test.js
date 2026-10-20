import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs/promises'
import { parse, compileScript } from 'vue/compiler-sfc'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import ElementPlus from 'element-plus'
import { createPinia } from 'pinia'
import { useChatStore } from '../src/stores/chat.js'

// 复用已安装的 Vue 编译器检查实际 SFC 模板，不引入额外浏览器测试依赖。
const modules = new Map()
async function componentUrl(url) {
  if (modules.has(url.href)) return modules.get(url.href)
  const { descriptor, errors } = parse(await fs.readFile(url, 'utf8'), { filename: url.pathname })
  assert.deepEqual(errors, [])
  let content = compileScript(descriptor, { id: url.pathname, inlineTemplate: true }).content
  const imports = [...content.matchAll(/from\s+(['"])([^'"]+)\1/g)]
  for (const [original, , specifier] of imports) {
    const resolved = specifier.endsWith('.vue') ? await componentUrl(new URL(specifier, url))
      : specifier.startsWith('.') ? new URL(specifier, url).href : import.meta.resolve(specifier)
    content = content.replace(original, `from ${JSON.stringify(resolved)}`)
  }
  const result = `data:text/javascript;base64,${Buffer.from(content).toString('base64')}`
  modules.set(url.href, result)
  return result
}
async function render(relative, props, pinia) {
  const { default: component } = await import(await componentUrl(new URL(relative, import.meta.url)))
  const app = createSSRApp({ render: () => h(component, props) })
  app.use(ElementPlus)
  if (pinia) app.use(pinia)
  return renderToString(app)
}

test('reference filenames and original snippets render as escaped text with their source locations', async () => {
  const html = await render('../src/components/chat/attachments/SourceReferences.vue', { mode: 'retrieval', sources: [{
    index: 1, fileId: 'file', chunkId: 'chunk', name: '<script>文件</script>.md', section: '会话规则', startLine: 3, endLine: 5, text: '<img src=x onerror=alert(1)> 原文'
  }] })
  assert.match(html, /相关片段/)
  assert.match(html, /第 3–5 行/)
  assert.match(html, /&lt;script&gt;/)
  assert.match(html, /&lt;img/)
  assert.doesNotMatch(html, /<script>|<img/)
})

test('assistant messages pass their own source numbers into Markdown and provide matching original snippets', async () => {
  const html = await render('../src/components/chat/ChatMessageItem.vue', { message: {
    id: 'reply', role: 'assistant', content: '音频原型的定义[index 4]。', documentMode: 'retrieval',
    sources: [{ index: 4, fileId: 'file', chunkId: 'audio', name: '说明.md', section: '音频原型', startLine: 8, endLine: 10, text: '音频原型是音频特征的代表。' }]
  } })
  assert.match(html, /<button[^>]*class="source-citation"[^>]*data-source-index="4"/)
  assert.match(html, /<details[^>]*class="source-item"[^>]*data-source-index="4"/)
  assert.match(html, /第 8–10 行/)
  assert.match(html, /音频原型是音频特征的代表/)
  assert.doesNotMatch(html, /\[index 4\]/)
})

test('composer renders upload errors, remove/retry controls and prevents submit while an attachment is not ready', async () => {
  const html = await render('../src/components/chat/ChatComposer.vue', { modelValue: '我的问题', canSend: false,
    attachments: [{ id: 'local', name: '说明.md', size: 100, status: 'error', error: '需要 UTF-8 编码' }] })
  assert.match(html, /需要 UTF-8 编码/)
  assert.match(html, /重试/)
  assert.match(html, /移除 说明.md/)
  assert.match(html, /附件就绪后可发送/)
  assert.match(html, /<button[^>]*disabled[^>]*aria-label="发送消息"/)
  assert.match(html, /<button[^>]*type="button"[^>]*aria-label="上传 TXT 或 MD 文件"/)
})

test('sent files remain visible for follow-ups and cannot be removed as pending attachments', async () => {
  const html = await render('../src/components/chat/ChatComposer.vue', { modelValue: '追问', referenceFile: { id: 'file', name: '资料.md', size: 100, status: 'ready' } })
  assert.match(html, /后续提问会继续使用/)
  assert.match(html, /资料.md/)
  assert.doesNotMatch(html, /移除 资料.md/)
  assert.match(html, /<button[^>]*disabled[^>]*aria-label="上传 TXT 或 MD 文件"/)
})

test('a missing AI answer renders a visible error and retry button in the actual chat page', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response('data: [DONE]\n\n'))
  const pinia = createPinia()
  const store = useChatStore(pinia)
  t.after(() => store.$dispose())
  store.inputMessage = '保留我的问题'
  await store.sendMessage()
  const html = await render('../src/views/ChatView.vue', {}, pinia)
  assert.match(html, /AI 本次没有返回回复正文/)
  assert.match(html, /重试回复/)
  assert.match(html, /保留我的问题/)
})

test('the virtual message list shows one waiting status until the first reply text arrives', async () => {
  const messages = [
    { id: 'question', role: 'user', content: '请解释这份资料' },
    { id: 'reply', role: 'assistant', content: '', sources: [] }
  ]
  const props = { messages, sessionId: 'session', isGenerating: true, generationStatus: '正在查阅文件…' }
  const waiting = await render('../src/components/chat/ChatMessageList.vue', props)
  assert.match(waiting, /请解释这份资料/)
  assert.match(waiting, /正在查阅文件…/)
  assert.equal(waiting.match(/role="status"/g)?.length, 1)
  assert.doesNotMatch(waiting, /AI 助手/)

  messages[1].content = '资料说明了设备的操作步骤。'
  const replying = await render('../src/components/chat/ChatMessageList.vue', props)
  assert.match(replying, /资料说明了设备的操作步骤/)
  assert.match(replying, /AI 助手/)
  assert.doesNotMatch(replying, /role="status"|正在查阅文件/)

  const withoutPlaceholder = await render('../src/components/chat/ChatMessageList.vue', { ...props, messages: [messages[0]] })
  assert.equal(withoutPlaceholder.match(/role="status"/g)?.length, 1)
})

test('sidebar provides separate select and delete buttons with accessible conversation titles', async () => {
  const id = crypto.randomUUID()
  const html = await render('../src/components/chat/ChatSidebar.vue', {
    sessions: [{ id, title: '<script>历史会话</script>', isGenerating: true }], activeSessionId: id
  })
  assert.match(html, /aria-pressed="true"/)
  assert.match(html, /正在回复/)
  assert.match(html, /aria-label="删除会话：&lt;script&gt;历史会话&lt;\/script&gt;"/)
  assert.doesNotMatch(html, /<script>/)
  assert.equal(html.match(/<button[^>]*class="session-delete"/g).length, 1)
})
