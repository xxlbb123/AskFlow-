<script setup>
import { onScopeDispose, ref, watch } from 'vue'
import { Check, DocumentCopy } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { copyText } from '../../utils/clipboard.js'

const props = defineProps({
  text: { type: String, default: '' },
  label: { type: String, default: '复制' }
})

const copied = ref(false)
const isCopying = ref(false)
let resetTimer
let disposed = false

const resetCopied = () => {
  clearTimeout(resetTimer)
  copied.value = false
}

// 传入的文本变化时，上次复制的只是旧内容，需要恢复按钮状态。
watch(() => props.text, resetCopied)
onScopeDispose(() => {
  disposed = true
  clearTimeout(resetTimer)
})

const copy = async () => {
  if (!props.text || isCopying.value) return
  const textAtClick = props.text
  isCopying.value = true
  resetCopied()
  try {
    await copyText(textAtClick)
    if (disposed) return
    if (props.text === textAtClick) {
      copied.value = true
      resetTimer = setTimeout(resetCopied, 2000)
    } else {
      ElMessage.success('已复制点击时的回复内容')
    }
  } catch {
    ElMessage.error('复制失败，请重试')
  } finally {
    isCopying.value = false
  }
}
</script>

<template>
  <button
    type="button"
    class="copy-button"
    :class="{ 'is-copied': copied }"
    :disabled="!text || isCopying"
    :aria-busy="isCopying"
    :aria-label="copied ? `${label}，已复制` : label"
    :title="label"
    @click="copy"
  >
    <el-icon aria-hidden="true"><Check v-if="copied" /><DocumentCopy v-else /></el-icon>
    <span aria-live="polite">{{ copied ? '已复制' : label }}</span>
  </button>
</template>

<style scoped lang="scss">
.copy-button {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 5px 8px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--chat-muted);
  font-size: 12px;
  line-height: 1.5;
  cursor: pointer;

  &:hover {
    background: var(--chat-hover-background);
    color: var(--chat-accent);
  }

  &.is-copied {
    color: var(--chat-accent);
  }

  &:disabled {
    opacity: 0.6;
    cursor: default;
  }

  .el-icon {
    font-size: 14px;
  }
}
</style>
