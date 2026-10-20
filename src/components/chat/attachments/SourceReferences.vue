<script setup>
import { ref } from 'vue'

const props = defineProps({ sources: { type: Array, default: () => [] }, mode: { type: String, default: '' } })
const references = ref(null)
// 通过父组件将编号交给原文列表组件
// 正文引用和下方资料使用同一编号，点击引用时展开对应原文。
const openSource = (index) => {
  if (!Number.isSafeInteger(index) || !props.sources.some(source => source.index === index)) return
  const container = references.value
  const item = container?.querySelector(`[data-source-index="${index}"]`)
  if (!item) return
  container.open = true //展开整个参考资料列表
  item.open = true //展开这一条原文
  item.querySelector('summary')?.focus({ preventScroll: true })
  item.scrollIntoView({ block: 'nearest' })
}

defineExpose({ openSource })
</script>
<template>
  <!-- 这个是浏览器原生的<details></details>  折叠元素 当我们设置open=true的时候就可以展开-->
  <details v-if="sources.length" ref="references" class="source-references">
    <summary>本次参考资料 · {{ sources.length }} 处{{ mode === 'retrieval' ? '（相关片段）' : '' }}</summary>
    <div class="source-list">
      <details v-for="source in sources" :key="`${source.fileId}:${source.chunkId}`" class="source-item" :data-source-index="source.index">
        <summary>[{{ source.index }}] {{ source.name }} · {{ source.section }} · 第 {{ source.startLine }}–{{ source.endLine }} 行</summary>
        <pre>{{ source.text }}</pre>
      </details>
    </div>
  </details>
</template>
<style scoped lang="scss">
.source-references {
  margin-top: 14px;
  color: var(--chat-muted);
  font-size: 12px;
  summary { cursor: pointer; overflow-wrap: anywhere; line-height: 1.7; }
  .source-list { display: grid; gap: 8px; margin-top: 8px; }
  .source-item {
    padding: 10px 12px;
    border: 1px solid var(--chat-border-strong);
    border-radius: 8px;
    &:focus-within {
      border-color: var(--chat-accent-border-hover);
      background: var(--chat-accent-soft);
    }
    pre { max-height: 260px; overflow: auto; margin: 8px 0 0; white-space: pre-wrap; overflow-wrap: anywhere; color: var(--chat-text); font: inherit; line-height: 1.7; }
  }
}
</style>
