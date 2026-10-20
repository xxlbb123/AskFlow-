<script setup>
import { computed } from 'vue'
import { ElMessage } from 'element-plus'
import { renderMarkdown } from '../../utils/markdown.js'
import { copyText } from '../../utils/clipboard.js'

// 父组件传入 Markdown 原文，展示组件不依赖聊天 Store。
const props = defineProps({
  content: { type: String, default: '' },
  sources: { type: Array, default: () => [] }
})
const emit = defineEmits(['select-source'])

// 流式回复每次追加文字，计算属性都会根据最新内容重新解析。
// 这里使用computed是因为AI的回复是逐步追加的
const renderedContent = computed(() => renderMarkdown(props.content, props.sources))

// v-html 里的按钮不是 Vue 组件，通过事件委托处理每一个代码块的复制。
const handleContentClick = async (event) => {
  const container = event.currentTarget //绑定了监听函数的外层.markdown-content
  
  const citation = event.target?.closest?.('[data-source-index]')
  if (citation && container.contains(citation)) {
    const index = Number(citation.dataset.sourceIndex)
    if (props.sources.some(source => source.index === index)) emit('select-source', index)
    return
  }
  // event.target 是实际点击到的元素，可能是按钮，也可能是按钮里的文字或图标
  
  const button = event.target?.closest?.('[data-copy-code]')
  // 所以代码使用closest() 会从当前元素开始，向父级查找最近的、符合选择器的元素。这样无论你点击文字、图标还是按钮本身，都可以找到复制按钮。
   
  if (!button || !container.contains(button) || button.disabled) return
  // 下面这个查找顺序是通过复制按钮->找到它所属的代码块 ->在这个代码块里面找到pre 下的 code
  const code = button.closest('.markdown-code-block')?.querySelector('pre code')
  if (!code) return
  // 在找到之后下面执行复制逻辑
  
  button.disabled = true
  try {
    // textContent 去掉高亮的 span 标签，保留代码的缩进、换行和特殊字符。
    // textContent取得的是代码里面的文本内容
    await copyText(code.textContent ?? '')
    ElMessage.success('代码已复制')
  } catch {
    ElMessage.error('复制代码失败，请重试')
  } finally {
    button.disabled = false
  }
}
</script>

<template>
  <div class="markdown-content" @click="handleContentClick" v-html="renderedContent"></div>
</template>

<style scoped lang="scss">
.markdown-content {
  --markdown-code-font: "SFMono-Regular", Consolas, "Liberation Mono", monospace;

  width: 100%;
  min-width: 0;
  color: var(--chat-text);
  font-size: 15px;
  line-height: 1.75;
  white-space: normal;
  overflow-wrap: anywhere;

  // v-html 生成的元素没有 scoped 属性，需要通过 :deep() 设置样式。
  :deep(p),
  :deep(ul),
  :deep(ol),
  :deep(blockquote),
  :deep(pre),
  :deep(.markdown-code-block),
  :deep(.markdown-table-scroll) {
    margin: 0 0 14px;
  }
  //  设置段落间距，标题大小和层次
  :deep(h1),
  :deep(h2),
  :deep(h3),
  :deep(h4),
  :deep(h5),
  :deep(h6) {
    margin: 24px 0 10px;
    color: var(--chat-text);
    font-weight: 600;
    line-height: 1.45;
  }

  :deep(h1) {
    font-size: 22px;
  }

  :deep(h2) {
    font-size: 20px;
  }

  :deep(h3) {
    font-size: 17px;
  }

  :deep(h4),
  :deep(h5),
  :deep(h6) {
    font-size: 15px;
  }
  //  列表缩进，编号，嵌套列表间距
  :deep(ul),
  :deep(ol) {
    padding-left: 1.6em;
    list-style-position: outside;
  }

  :deep(ul) {
    list-style-type: disc;
  }

  :deep(ol) {
    list-style-type: decimal;
  }

  :deep(ul ul) {
    list-style-type: circle;
  }

  :deep(li) {
    margin: 5px 0;
    padding-left: 3px;

    &::marker {
      color: var(--chat-text-secondary);
    }

    > p {
      margin-bottom: 8px;
    }

    > ul,
    > ol {
      margin: 8px 0;
    }

    > :last-child {
      margin-bottom: 0;
    }
  }

  :deep(strong) {
    color: var(--chat-text);
    font-weight: 600;
  }

  :deep(a) {
    color: var(--chat-accent);
    text-decoration: underline;
    text-underline-offset: 3px;
  }

  :deep(.source-citation) {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 18px;
    height: 18px;
    margin: 0 2px;
    padding: 0 4px;
    border: 0;
    border-radius: 5px;
    background: var(--chat-hover-background);
    color: var(--chat-text-secondary);
    font: inherit;
    font-size: 11px;
    font-weight: 500;
    line-height: 1;
    vertical-align: super;
    cursor: pointer;

    &:hover {
      background: var(--chat-accent-soft);
      color: var(--chat-accent);
    }

    &:focus-visible {
      outline: 2px solid var(--chat-accent);
      outline-offset: 2px;
    }
  }

  :deep(blockquote) {
    padding: 10px 16px;
    border-left: 3px solid var(--chat-accent);
    border-radius: 0 8px 8px 0;
    background: var(--chat-accent-soft);
    color: var(--chat-text-secondary);

    > :last-child {
      margin-bottom: 0;
    }
  }

  :deep(code) {
    padding: 2px 5px;
    border-radius: 4px;
    background: var(--chat-hover-background);
    font-family: var(--markdown-code-font);
    font-size: 0.9em;
  }

  :deep(pre) {
    max-width: 100%;
    padding: 16px;
    overflow-x: auto;
    border: 1px solid var(--chat-border);
    border-radius: 8px;
    background: var(--chat-sidebar-background);
    color: var(--chat-text);
    font-family: var(--markdown-code-font);
    font-size: 13px;
    line-height: 1.6;
    white-space: pre;
    overflow-wrap: normal;
    tab-size: 2;

    code {
      padding: 0;
      border-radius: 0;
      background: transparent;
      font: inherit;
      white-space: inherit;
    }
  }

  :deep(.markdown-code-block) {
    max-width: 100%;
    overflow: hidden;
    border: 1px solid var(--chat-border);
    border-radius: 8px;
    background: var(--chat-sidebar-background);

    pre {
      margin: 0;
      border: 0;
      border-radius: 0;
    }
  }

  :deep(.code-block-toolbar) {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 7px 12px;
    border-bottom: 1px solid var(--chat-border);
    background: var(--chat-hover-background);
    color: var(--chat-text-secondary);
    font-size: 12px;
    line-height: 1.5;
  }

  :deep(.code-block-language) {
    min-width: 0;
    overflow: hidden;
    font-family: var(--markdown-code-font);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  :deep(.code-copy-button) {
    display: inline-flex;
    flex-shrink: 0;
    align-items: center;
    gap: 5px;
    padding: 4px 8px;
    border: 0;
    border-radius: 5px;
    background: transparent;
    color: var(--chat-text-secondary);
    font-size: inherit;
    line-height: inherit;
    cursor: pointer;

    &:hover {
      background: var(--chat-surface);
      color: var(--chat-accent);
    }

    &:disabled {
      opacity: 0.6;
      cursor: default;
    }
  }

  // 高亮颜色由主题变量提供，切换日夜主题时无需重新解析代码。
  :deep(.hljs-comment),
  :deep(.hljs-quote) {
    color: var(--chat-code-comment);
    font-style: italic;
  }

  :deep(.hljs-keyword),
  :deep(.hljs-doctag),
  :deep(.hljs-selector-tag),
  :deep(.hljs-meta .hljs-keyword) {
    color: var(--chat-code-keyword);
  }

  :deep(.hljs-string),
  :deep(.hljs-regexp),
  :deep(.hljs-addition),
  :deep(.hljs-meta .hljs-string) {
    color: var(--chat-code-string);
  }

  :deep(.hljs-number),
  :deep(.hljs-literal),
  :deep(.hljs-symbol),
  :deep(.hljs-bullet) {
    color: var(--chat-code-number);
  }

  :deep(.hljs-title),
  :deep(.hljs-section) {
    color: var(--chat-code-function);
  }

  :deep(.hljs-built_in),
  :deep(.hljs-type),
  :deep(.hljs-title.class_) {
    color: var(--chat-code-type);
  }

  :deep(.hljs-attr),
  :deep(.hljs-attribute),
  :deep(.hljs-variable),
  :deep(.hljs-name),
  :deep(.hljs-selector-class),
  :deep(.hljs-selector-id),
  :deep(.hljs-deletion) {
    color: var(--chat-code-variable);
  }

  :deep(.hljs-meta),
  :deep(.hljs-punctuation) {
    color: var(--chat-text-secondary);
  }

  :deep(.hljs-emphasis) {
    font-style: italic;
  }

  :deep(.hljs-strong) {
    font-weight: 600;
  }

  :deep(.markdown-table-scroll) {
    max-width: 100%;
    overflow-x: auto;

    &:focus-visible {
      outline: 2px solid var(--chat-accent);
      outline-offset: 2px;
    }
  }

  :deep(table) {
    width: 100%;
    border-collapse: collapse;
    font-size: 14px;
    line-height: 1.6;
  }

  :deep(th),
  :deep(td) {
    min-width: 100px;
    padding: 9px 12px;
    border: 1px solid var(--chat-border);
    vertical-align: top;
  }

  :deep(th) {
    background: var(--chat-sidebar-background);
    font-weight: 600;
  }

  :deep(hr) {
    margin: 22px 0;
    border: 0;
    border-top: 1px solid var(--chat-border);
  }

  :deep(img) {
    max-width: 100%;
    height: auto;
    border-radius: 8px;
  }

  > :deep(:first-child) {
    margin-top: 0;
  }

  > :deep(:last-child) {
    margin-bottom: 0;
  }

  @media (max-width: 767px) {
    :deep(pre) {
      padding: 12px;
    }

    :deep(th),
    :deep(td) {
      padding: 8px 10px;
    }
  }
}
</style>
