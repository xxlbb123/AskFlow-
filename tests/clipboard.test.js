import assert from 'node:assert/strict'
import test from 'node:test'
import { copyText } from '../src/utils/clipboard.js'

function installNavigator(t, value) {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value })
  t.after(() => {
    if (original) Object.defineProperty(globalThis, 'navigator', original)
    else delete globalThis.navigator
  })
}

test('copy preserves complete Markdown and code whitespace without conversion', async t => {
  const copied = []
  installNavigator(t, { clipboard: { async writeText(text) { copied.push(text) } } })
  const reply = '### 标题\n\n**重点**\n\n```js\n  const text = "<tag>&中文"\n```'
  const code = '\n  const text = "<tag>&中文"\n\tconsole.log(text)\n'
  await copyText(reply)
  await copyText(code)
  assert.deepEqual(copied, [reply, code])
})

test('clipboard permission failures reject instead of reporting a successful copy', async t => {
  const denied = new Error('Permission denied')
  installNavigator(t, { clipboard: { async writeText() { throw denied } } })
  await assert.rejects(copyText('hello'), error => error === denied)
})

test('a missing clipboard API is handled as a copy failure', async t => {
  installNavigator(t, {})
  await assert.rejects(copyText('hello'), /不支持剪贴板写入/)
})

test('server rendering never attempts to write a browser clipboard', async t => {
  installNavigator(t, undefined)
  await assert.rejects(copyText('hello'), /不支持剪贴板写入/)
})
