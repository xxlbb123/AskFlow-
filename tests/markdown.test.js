import assert from 'node:assert/strict'
import test from 'node:test'
import { renderMarkdown } from '../src/utils/markdown.js'

test('AI prose renders headings, emphasis, lists and quotes instead of raw markers', () => {
  const html = renderMarkdown('### 核心人物\n\n- **身份：** 成都交警\n- *风格：* 幽默\n\n1. 第一项\n2. 第二项\n\n> 一段引用')
  for (const tag of ['h3', 'strong', 'em', 'ul', 'ol', 'li', 'blockquote']) {
    assert.match(html, new RegExp(`<${tag}>`))
  }
  assert.ok(!html.includes('###'))
  assert.ok(!html.includes('**身份'))
  assert.match(renderMarkdown('第一行\n第二行'), /第一行<br>\n第二行/)
})

test('code stays literal and HTML in code blocks is escaped', () => {
  const html = renderMarkdown('使用 `const name = "AI"`\n\n```html\n<script>alert("hello")</script>\n```')
  assert.match(html, /<code>const name = &quot;AI&quot;<\/code>/)
  assert.match(html, /<pre><code class="hljs language-html">/)
  assert.ok(html.replace(/<[^>]*>/g, '').includes('&lt;script&gt;'))
  assert.ok(!html.includes('<script>'))
})

test('raw model HTML and dangerous link protocols cannot create executable markup', () => {
  const html = renderMarkdown('<img src=x onerror=alert(1)>\n\n<script>alert(1)</script>\n\n[点击](javascript:alert(1))\n\n[点击](vbscript:evil)\n\n[点击](data:text/html;base64,PHNjcmlwdD4=)')
  assert.ok(!/<(?:img|script|a)\b/i.test(html))
  assert.ok(html.includes('&lt;img'))
  assert.ok(html.includes('&lt;script&gt;'))
})

test('explicit and automatic links open safely in a new tab', () => {
  const html = renderMarkdown('[Vue 文档](https://vuejs.org/)\n\nhttps://example.com')
  const links = html.match(/<a\b[^>]*>/g)
  assert.equal(links.length, 2)
  for (const link of links) {
    assert.match(link, /target="_blank"/)
    assert.match(link, /rel="noopener noreferrer"/)
  }
})

test('tables have their own accessible scrolling container', () => {
  const html = renderMarkdown('| 名称 | 说明 |\n| --- | --- |\n| Vue | 页面 |')
  assert.match(html, /<div class="markdown-table-scroll" role="region" aria-label="表格" tabindex="0"><table>/)
  assert.match(html, /<th>名称<\/th>/)
  assert.match(html, /<td>页面<\/td>/)
  assert.match(html, /<\/table><\/div>/)
})

test('unfinished streamed emphasis and code fences render again as content arrives', () => {
  let content = ''
  const chunks = ['### 流式回复\n\n**重', '点**\n\n```js\n', 'const value = "<script>"', '\n```']
  for (const chunk of chunks) {
    content += chunk
    const html = renderMarkdown(content)
    assert.equal(typeof html, 'string')
    assert.ok(!html.includes('<script>'))
  }
  const html = renderMarkdown(content)
  assert.match(html, /<strong>重点<\/strong>/)
  assert.match(html, /<pre><code class="hljs language-js">/)
  assert.ok(html.includes('&lt;script&gt;'))
  assert.equal(renderMarkdown(''), '')
})

test('code blocks show syntax colors, a language label and their own copy button', () => {
  const html = renderMarkdown('```js\nconst message = "hello";\nconsole.log(message);\n```')
  assert.match(html, /class="hljs-keyword">const<\/span>/)
  assert.match(html, /class="hljs-string">/)
  assert.match(html, /class="code-block-language">js<\/span>/)
  assert.match(html, /<button type="button" class="code-copy-button" data-copy-code/)
  assert.ok(!renderMarkdown('只有 `行内代码`').includes('data-copy-code'))
})

test('Vue fences highlight template markup and unmarked code can be detected', () => {
  const vue = renderMarkdown('```vue\n<template><p>{{ message }}</p></template>\n```')
  assert.match(vue, /class="hljs-name">template<\/span>/)
  assert.match(vue, /class="code-block-language">vue<\/span>/)
  const automatic = renderMarkdown('```\nconst message = "hello";\nconsole.log(message);\n```')
  assert.match(automatic, /class="hljs-keyword">const<\/span>/)
})

test('unknown languages remain literal and cannot inject markup through the fence label', () => {
  const html = renderMarkdown('```unknown\n  <img src=x onerror=alert(1)>\n\tline & value\n```')
  assert.match(html, /<code class="hljs language-unknown">  &lt;img src=x onerror=alert\(1\)&gt;\n\tline &amp; value\n<\/code>/)
  assert.ok(!html.includes('<img'))
  const label = renderMarkdown('```js"onclick="evil\n<script>alert(1)</script>\n```')
  assert.match(label, /<code class="hljs language-js&quot;onclick=&quot;evil">/)
  assert.ok(!label.includes('<script>'))
})

test('highlighting preserves code whitespace and characters after removing only span tags', () => {
  const html = renderMarkdown('```js\n  const value = "<tag>&quot;&</tag>";\n\tconsole.log(value);\n```')
  const code = html.match(/<pre><code[^>]*>([\s\S]*?)<\/code><\/pre>/)[1]
  assert.equal(
    code.replace(/<\/?span\b[^>]*>/g, ''),
    '  const value = &quot;&lt;tag&gt;&amp;quot;&amp;&lt;/tag&gt;&quot;;\n\tconsole.log(value);\n'
  )
})

test('nested and indented code blocks each receive a separate copy control', () => {
  const html = renderMarkdown('> ```python\n> print("hello")\n> ```\n\n    indented code\n')
  assert.equal((html.match(/data-copy-code/g) ?? []).length, 2)
  assert.match(html, /<blockquote>/)
  assert.ok(html.replace(/<[^>]*>/g, '').includes('indented code'))
})

const sources = [
  { index: 1, name: '说明.md', section: 'MarineGen' },
  { index: 4, name: '说明.md', section: '音频原型' }
]

test('known source numbers and legacy index markers render compact references using this message’s sources', () => {
  const html = renderMarkdown('MarineGen 的定义[index 1]。音频原型的说明[4][index 4]。', sources)
  assert.equal((html.match(/class="source-citation"/g) ?? []).length, 3)
  assert.match(html, /data-source-index="1"[^>]*>1<\/button>/)
  assert.match(html, /data-source-index="4"[^>]*>4<\/button>/)
  assert.match(html, /aria-label="查看来源 4：说明.md · 音频原型"/)
  assert.doesNotMatch(html, /\[index/)
  assert.doesNotMatch(renderMarkdown('另一条消息[1]'), /source-citation/)
  assert.match(renderMarkdown('来源不在本条消息中[index 99]', sources), /\[index 99\]/)
})

test('citation rendering preserves inline code, code blocks, escaped brackets and Markdown links', () => {
  const content = '`[4] [index 4]`\n\n```text\n[4] [index 4]\n```\n\n\\[4]\n\n[4](https://example.com)\n\n[查看 [4]](https://example.com)'
  const html = renderMarkdown(content, sources)
  assert.doesNotMatch(html, /source-citation/)
  assert.match(html, /<code>\[4\] \[index 4\]<\/code>/)
  assert.match(html, /<code class="hljs language-text">\[4\] \[index 4\]\n<\/code>/)
  assert.equal((html.match(/<a\b/g) ?? []).length, 2)
  const referenceLink = renderMarkdown('[4]\n\n[4]: https://example.com', sources)
  assert.match(referenceLink, /href="https:\/\/example.com"/)
  assert.doesNotMatch(referenceLink, /source-citation/)
})

test('streaming references appear only once the marker is complete and sources arrive', () => {
  for (const content of ['定义[', '定义[index ', '定义[index 4']) {
    assert.doesNotMatch(renderMarkdown(content, sources), /source-citation/)
  }
  assert.doesNotMatch(renderMarkdown('定义[index 4]'), /source-citation/)
  assert.match(renderMarkdown('定义[index 4]', sources), /data-source-index="4"/)
})

test('source metadata cannot inject markup into citation attributes', () => {
  const html = renderMarkdown('依据[1]', [{ index: 1, name: '\"><img src=x onerror=alert(1)>', section: '<script>evil</script>' }])
  assert.match(html, /data-source-index="1"/)
  assert.match(html, /&quot;&gt;&lt;img/)
  assert.doesNotMatch(html, /<img|<script|" onerror=/)
})
