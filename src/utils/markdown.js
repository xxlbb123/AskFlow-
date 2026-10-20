import MarkdownIt from 'markdown-it'
import { highlightCode } from './highlight.js'

// AI 返回的内容仍然保存为 Markdown 文本，只在展示时转换成 HTML。
// 这个markdown是通过markdown-it创建的解析器，可以通过.render()把markdown转成HTML
const markdown = new MarkdownIt({
  html: false, // 原始 HTML 按文本展示，避免执行回复中的标签或脚本。
  breaks: true, //同一段落内的普通换行转换成<br>
  linkify: true // 将符合规则的普通网址自动转换成链接
})

const defaultLinkOpen = markdown.renderer.rules.link_open
  ?? ((tokens, index, options, env, renderer) => renderer.renderToken(tokens, index, options)) //右侧这个函数的作用是接收token，生成HTML字符串
// 初始加载的时候赋值
markdown.renderer.rules.link_open = (tokens, index, options, env, renderer) => {
  tokens[index].attrSet('target', '_blank')
  tokens[index].attrSet('rel', 'noopener noreferrer')
  return defaultLinkOpen(tokens, index, options, env, renderer)
}

// 在正文中识别来源编号；Markdown 链接、行内代码和代码块仍按原规则解析。
// env 中的来源只属于本次渲染，避免不同消息的引用编号串到一起。
markdown.inline.ruler.after('link', 'source_citation', (state, silent) => {
  // 链接标签的预扫描不消耗引用标记，避免把“链接文字中的 [4]”误判成嵌套链接。
  if (silent || state.src[state.pos] !== '[' || state.linkLevel > 0) return false
  // 识别[1],这里也兼容[index 1]
  const match = state.src.slice(state.pos).match(/^\[(?:index\s*)?([1-9]\d*)\]/i)
  // 检查这个编号是否有对应的来源
  const source = match && state.env.citationSources?.get(Number(match[1]))
  if (!source) return false
  // 找到来源之后，规则会创建一个source_citation类型的token(解析结果节点),对应的渲染函数再把它生成HTML
  const token = state.push('source_citation', '', 0)
  token.content = match[1]
  token.meta = source
  state.pos += match[0].length
  return true
})

markdown.renderer.rules.source_citation = (tokens, index) => {
  const token = tokens[index]
  const label = markdown.utils.escapeHtml([token.meta.name, token.meta.section].filter(Boolean).join(' · '))
  return `<button type="button" class="source-citation" data-source-index="${token.content}" aria-label="查看来源 ${token.content}：${label}" title="${label}">${token.content}</button>`
}

// 表格独立横向滚动，避免较多列把整个聊天页面撑宽。
markdown.renderer.rules.table_open = () => (
  '<div class="markdown-table-scroll" role="region" aria-label="表格" tabindex="0"><table>\n'
)
markdown.renderer.rules.table_close = () => '</table></div>\n'
// markdown-it解析markdown时，会先生成一组记录语法信息的对象，这些对象叫Token，再根据他们生成HTML，例如
// ```js
// const message = "Hello"
// ```
// 解析之后代码块对应的Token中会包含这些信息:
// {
//   type: 'fence', 这是哪种语法，fence表示使用围栏标记的代码块
//   info: 'js',  开头的三个反引号后面的信息，这里是js
//   content: 'const message = "Hello"\n' 代码块内部的原始代码，不包含两侧的反引号
// }
// 下面这个函数是从Token数组中取出当前所需要处理的代码块
// tokens和这个index是解析器调用这个函数时自动传入的，不需要我们在组件中自己准备 
const renderCodeBlock = (tokens, index) => {
  const token = tokens[index]
  // /\s+/ \s表示空白字符，例如空格制表符 +表示一个或者多个
  const language = markdown.utils.unescapeAll(token.info ?? '').trim().split(/\s+/)[0].toLowerCase()
  const highlighted = highlightCode(token.content, language)
  //  下面这一行决定工具栏上显示的语言名称
  const label = language || highlighted?.language || 'text'
  // escapeHtml() 会把有 HTML 含义的字符转换成字符实体
  const safeLabel = markdown.utils.escapeHtml(label)
  // 这里的??是空值合并运算符，只有左边是null或者undefined的时候才使用右边
  const code = highlighted?.value ?? markdown.utils.escapeHtml(token.content)

  // 这里只生成 HTML，复制事件由 MarkdownContent 在外层统一监听。
  return `
<div class="markdown-code-block">
<div class="code-block-toolbar">
<span class="code-block-language">${safeLabel}</span>
<button type="button" class="code-copy-button" data-copy-code aria-label="复制代码" title="复制代码">
<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V4H4v12h4"/></svg>
<span>复制代码</span>
</button>
</div>
<pre><code class="hljs language-${safeLabel}">${code}</code></pre>
</div>\n`
}
// 解析器通过这两行注册来得知调用这个函数,含义就是将这两种代码块的HTML生成规则替换成我们renderCodeBlock函数
// fence是用三个反引号或者波浪号包裹的代码块
markdown.renderer.rules.fence = renderCodeBlock
// code_block是用缩进形成的代码块,通常为四个空格
markdown.renderer.rules.code_block = renderCodeBlock

export const renderMarkdown = (content = '', sources = []) => markdown.render(content, {
  citationSources: new Map(sources.filter(source => Number.isSafeInteger(source?.index) && source.index > 0)
    .map(source => [source.index, source]))
})
