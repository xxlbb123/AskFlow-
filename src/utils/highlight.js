// 引入的是已经包含常见语言规则的版本
import hljs from 'highlight.js/lib/common'

// 使用常见语言集合；Vue 单文件组件按 HTML 高亮，其中的 script/style 也会着色。
//给xml语言规则增加一个叫做vue的别名
hljs.registerAliases('vue', { languageName: 'xml' })
// 下面这个数组用于没有明确语言时自动识别范围
const autoLanguages = ['javascript', 'xml', 'css', 'json', 'python', 'bash', 'sql']

export const highlightCode = (code, language = '') => {
  try {
    if (language) {
      if (!hljs.getLanguage(language)) return null
      // 流式代码可能暂时缺少括号或引号，仍然尽量显示高亮。
      // 他这个返回一个对象
      //  {
      //  language: 'js',
      //   value: '<span class="hljs-keyword">const</span> ...'
      //  } 
      return hljs.highlight(code, { language, ignoreIllegals: true })
    }
    return hljs.highlightAuto(code, autoLanguages)
  } catch {
    // 无法识别或高亮失败时，由 Markdown 解析器转义并展示原始代码。
    return null
  }
}
