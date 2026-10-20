import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs/promises'
import { parse, compileScript } from 'vue/compiler-sfc'
import { createRenderer, h, nextTick, reactive } from 'vue'

const moduleUrl = code => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
const vueUrl = import.meta.resolve('vue')
// Keep the real list's template, lifecycle, event handlers and watchers; replace
// only child rendering and virtual-scroller layout, which need a browser DOM.
const scrollerUrl = moduleUrl(`
  import { h } from ${JSON.stringify(vueUrl)}
  export const DynamicScroller = {
    props: ['items', 'minItemSize', 'prerender', 'keyField'],
    setup: (props, { slots }) => () => h('scroll-viewport', null, [
      props.items.map((item, index) => slots.default?.({ item, index, active: true })),
      slots.after?.()
    ])
  }
  export const DynamicScrollerItem = {
    props: ['item', 'active', 'index', 'emitResize'],
    setup: (_, { slots }) => () => h('message-row', null, slots.default?.())
  }
`)
const messageUrl = moduleUrl(`
  import { h } from ${JSON.stringify(vueUrl)}
  export default { props: ['message'], setup: props => () => h('message', props.message.content) }
`)
const filename = new URL('../src/components/chat/ChatMessageList.vue', import.meta.url)
const { descriptor, errors } = parse(await fs.readFile(filename, 'utf8'), { filename: filename.pathname })
assert.deepEqual(errors, [])
let compiled = compileScript(descriptor, { id: 'message-list-scroll', inlineTemplate: true }).content
for (const [original, , specifier] of [...compiled.matchAll(/from\s+(['"])([^'"]+)\1/g)]) {
  const resolved = specifier === 'vue-virtual-scroller' ? scrollerUrl
    : specifier.endsWith('.vue') ? messageUrl : import.meta.resolve(specifier)
  compiled = compiled.replace(original, `from ${JSON.stringify(resolved)}`)
}
const { default: ChatMessageList } = await import(moduleUrl(compiled))

const element = type => ({ type, props: {}, children: [], parent: null })
const renderer = createRenderer({
  createElement(type) {
    const node = element(type)
    if (type === 'scroll-viewport') {
      node.scrollHeight = 2000
      node.clientHeight = 500
      let top = 0
      Object.defineProperty(node, 'scrollTop', {
        get: () => top,
        set: value => { top = Math.max(0, Math.min(value, node.scrollHeight - node.clientHeight)) }
      })
    }
    return node
  },
  createText: text => ({ ...element('#text'), text }),
  createComment: text => ({ ...element('#comment'), text }),
  setText: (node, text) => { node.text = text },
  setElementText: (node, text) => { node.text = text; node.children = [] },
  patchProp: (node, key, previous, next) => { node.props[key] = next },
  insert(node, parent, anchor = null) {
    if (node.parent) node.parent.children.splice(node.parent.children.indexOf(node), 1)
    const index = anchor ? parent.children.indexOf(anchor) : -1
    parent.children.splice(index < 0 ? parent.children.length : index, 0, node)
    node.parent = parent
  },
  remove(node) {
    if (node.parent) node.parent.children.splice(node.parent.children.indexOf(node), 1)
    node.parent = null
  },
  parentNode: node => node.parent,
  nextSibling: node => node.parent?.children[node.parent.children.indexOf(node) + 1] ?? null
})
const find = (node, predicate) => predicate(node) ? node : node.children.map(child => find(child, predicate)).find(Boolean)
const settle = async () => { await nextTick(); await nextTick() }

async function mountList(t) {
  let nextFrame = 0
  const frames = new Map()
  const saved = ['requestAnimationFrame', 'cancelAnimationFrame'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)])
  globalThis.requestAnimationFrame = callback => { frames.set(++nextFrame, callback); return nextFrame }
  globalThis.cancelAnimationFrame = id => frames.delete(id)
  const state = reactive({
    sessionId: 'session-one', isGenerating: false,
    messages: [{ id: 'question', role: 'user', content: 'Question' }, { id: 'answer', role: 'assistant', content: 'Answer' }]
  })
  const root = element('root')
  const app = renderer.createApp({ render: () => h(ChatMessageList, state) })
  app.component('el-icon', { setup: (_, { slots }) => () => h('icon', null, slots.default?.()) })
  t.after(() => {
    app.unmount()
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else delete globalThis[key]
    }
  })
  app.mount(root)
  const viewport = () => find(root, node => node.type === 'scroll-viewport')
  const latestButton = () => find(root, node => node.type === 'button' && node.props.class === 'scroll-latest')
  const flushFrames = () => {
    const callbacks = [...frames.values()]
    frames.clear()
    callbacks.forEach(callback => callback(0))
  }
  await settle()
  flushFrames()
  assert.equal(viewport().scrollTop, 1500)
  return { state, viewport, latestButton, frames, flushFrames }
}

test('sending and streaming a reply preserve the history position while following is paused', async t => {
  const { state, viewport, latestButton, frames, flushFrames } = await mountList(t)
  viewport().scrollTop = 600
  viewport().props.onScrollPassive()
  await settle()
  assert.ok(latestButton())

  state.messages.push({ id: 'follow-up', role: 'user', content: 'Follow-up' }, { id: 'reply', role: 'assistant', content: '' })
  state.isGenerating = true
  viewport().scrollHeight = 2400
  await settle()
  viewport().props.onResize()
  await settle()
  assert.equal(frames.size, 0)

  state.messages.at(-1).content = 'A streamed reply'
  viewport().scrollHeight = 2800
  await settle()
  viewport().props.onResize()
  await settle()
  flushFrames()
  assert.equal(viewport().scrollTop, 600)
  assert.ok(latestButton())
})

test('an upward wheel cancels a queued send scroll before movement, even near the bottom', async t => {
  const { state, viewport, latestButton, frames, flushFrames } = await mountList(t)
  state.messages.push({ id: 'follow-up', role: 'user', content: 'Follow-up' })
  viewport().scrollHeight = 2020
  await settle()
  assert.equal(frames.size, 1)

  viewport().props.onWheelPassive({ deltaY: -1 })
  assert.equal(frames.size, 0)
  // Layout can emit a scroll without changing scrollTop. It must not undo the
  // user's wheel intent just because the position remains within 48px of bottom.
  viewport().props.onScrollPassive()
  viewport().props.onResize()
  await settle()
  flushFrames()
  assert.equal(viewport().scrollTop, 1500)
  assert.ok(latestButton())

  viewport().scrollTop = 1490
  viewport().props.onScrollPassive()
  viewport().props.onResize()
  await settle()
  assert.equal(frames.size, 0)
  assert.equal(viewport().scrollTop, 1490)
})

test('scrolling down near the bottom or choosing latest resumes following', async t => {
  const { state, viewport, latestButton, frames, flushFrames } = await mountList(t)
  viewport().scrollTop = 1450
  viewport().props.onScrollPassive()
  await settle()
  assert.ok(latestButton())

  viewport().scrollTop = 1470
  viewport().props.onScrollPassive()
  viewport().props.onResize()
  await settle()
  assert.equal(frames.size, 1)
  flushFrames()
  assert.equal(viewport().scrollTop, 1500)
  await settle()
  assert.equal(latestButton(), undefined)

  viewport().scrollTop = 600
  viewport().props.onScrollPassive()
  await settle()
  latestButton().props.onClick()
  await settle()
  flushFrames()
  assert.equal(viewport().scrollTop, 1500)

  state.messages.at(-1).content += ' More text'
  viewport().scrollHeight = 2100
  await settle()
  flushFrames()
  assert.equal(viewport().scrollTop, 1600)
})
