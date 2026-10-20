<script setup>
import { onMounted, ref } from 'vue'
import { Top, Paperclip } from '@element-plus/icons-vue'
import AttachmentList from './attachments/AttachmentList.vue'

const props = defineProps({
  modelValue: { type: String, default: '' },
  isGenerating: Boolean,
  attachments: { type: Array, default: () => [] },
  referenceFile: { type: Object, default: null },
  attachmentError: { type: String, default: '' },
  canSend: { type: Boolean, default: true }
})
// 自定义事件
const emit = defineEmits(['update:modelValue', 'send', 'attach', 'remove-attachment', 'retry-attachment', 'attachment-error'])
const input = ref(null)
const fileInput = ref(null)
const send = () => {
  if (props.modelValue.trim() && !props.isGenerating && props.canSend) emit('send')
}
const selectFiles = (files) => {
  if (!files?.length || props.isGenerating) return
  if (files.length > 1) { emit('attachment-error', '每次只能上传一个文件'); return }
  emit('attach', files[0])
}
const handleFileChange = (event) => {
  selectFiles(event.target.files)
  event.target.value = '' // 允许移除后再次选择同一个文件。
}
const handleDragOver = (event) => {
  if (Array.from(event.dataTransfer?.types ?? []).includes('Files')) event.preventDefault()
}
const handleDrop = (event) => {
  if (!Array.from(event.dataTransfer?.types ?? []).includes('Files')) return
  event.preventDefault()
  selectFiles(event.dataTransfer.files)
}
const handleKeydown = (event) => {
  if (event.key !== 'Enter' || event.shiftKey || event.isComposing || event.keyCode === 229) return
  event.preventDefault()
  send()
}
//focus方法用于聚焦输入框，并通过defineExpose暴露给父组件使用
const focus = () => input.value?.focus()
defineExpose({ focus })
onMounted(focus)
</script>

<template>
  <div class="composer-area">
    <form class="composer" aria-label="发送消息" @submit.prevent="send" @dragover="handleDragOver" @drop="handleDrop">
      <p v-if="referenceFile" class="reference-hint">本会话参考文件（后续提问会继续使用）</p>
      <AttachmentList :attachments="referenceFile ? [referenceFile] : attachments" :editable="!referenceFile && !isGenerating"
        @remove="emit('remove-attachment', $event)" @retry="emit('retry-attachment', $event)" />
      <p v-if="attachmentError" class="attachment-error" role="alert">{{ attachmentError }}</p>
      <el-input
        ref="input"
        :model-value="modelValue"
        @update:model-value="emit('update:modelValue', $event)"
        @keydown="handleKeydown"
        aria-label="消息内容"
        placeholder="输入你的问题，让我们一起探索…"
        type="textarea"
        :autosize="{ minRows: 2, maxRows: 5 }"
        resize="none"
        :disabled="isGenerating"
      />
      <div class="composer-toolbar tw:flex tw:items-center tw:justify-between tw:gap-3">
        <div class="composer-tools">
          <input ref="fileInput" class="file-input" type="file" accept=".txt,.md,text/plain,text/markdown" aria-label="选择文本附件" :disabled="isGenerating || !!referenceFile" @change="handleFileChange" />
          <button class="attach-button" type="button" :disabled="isGenerating || !!referenceFile" aria-label="上传 TXT 或 MD 文件" title="TXT / MD · UTF-8 · 最大 2 MB；每个会话一个文件" @click="fileInput?.click()">
            <el-icon><Paperclip /></el-icon><span>附件</span>
          </button>
          <span class="composer-hint">{{ isGenerating ? 'AI 正在回复…' : !canSend ? '附件就绪后可发送' : 'Enter 发送 · Shift + Enter 换行' }}</span>
        </div>
        <!-- 这个natuve-type="submit"是HTML 按钮的行为，表示提交表单，把按钮设置成表单提交按钮，点击之后浏览器会触发所属form的submit事件-->
        <el-button
          class="send-button"
          native-type="submit"
          type="primary"
          :icon="Top"
          :loading="isGenerating"
          :disabled="isGenerating || !canSend || !modelValue.trim()"
          aria-label="发送消息"
          title="发送消息"
        />
      </div>
    </form>
    <p class="composer-footer">{{ attachments.length || referenceFile ? '文件问答 · 长文件检索相关片段，回答可查看原文来源' : '支持 TXT / MD 附件 · UTF-8 · 最大 2 MB' }}</p>
  </div>
</template>

<style scoped lang="scss">
.composer-area {
  flex-shrink: 0;
  padding: 12px var(--chat-gutter) max(18px, env(safe-area-inset-bottom));

  @media (max-width: 767px) {
    padding-top: 10px;
    padding-bottom: max(12px, env(safe-area-inset-bottom));
  }
}

.composer {
  width: 100%;
  max-width: var(--chat-content-width);
  margin: 0 auto;
  padding: 16px 18px 12px;
  border: 1px solid var(--chat-border-strong);
  border-radius: 16px;
  background: var(--chat-surface);
  box-shadow: var(--chat-composer-shadow);
  transition: border-color 150ms, box-shadow 150ms;

  // & 代表当前选择器，这里编译为 .composer:focus-within。
  &:focus-within {
    border-color: var(--chat-accent-border-hover);
    box-shadow: var(--chat-composer-shadow), 0 0 0 2px var(--chat-focus-ring);
  }

  // :deep 用来调整 Element Plus 子组件内部的样式。
  :deep(.el-textarea__inner) {
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--chat-text);
    box-shadow: none;
    line-height: 1.8;
    font-size: 14px;

    &::placeholder {
      color: var(--chat-subtle);
    }
  }

  @media (max-width: 767px) {
    padding: 14px 14px 10px;
  }
}

.composer-toolbar {
  margin-top: 10px;
}

.file-input { display: none; }
.composer-tools {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px 12px;
  min-width: 0;
}
.attach-button {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
  padding: 5px 0;
  border: 0;
  background: transparent;
  color: var(--chat-muted);
  font-size: 12px;
  cursor: pointer;
  .el-icon { font-size: 17px; }
  &:hover { color: var(--chat-accent); }
  &:disabled { opacity: .5; cursor: default; }
  &:focus-visible { outline: 2px solid var(--chat-accent); outline-offset: 3px; border-radius: 3px; }
}
.reference-hint { margin: 0 0 6px; font-size: 11px; color: var(--chat-muted); }
.attachment-error { margin: 0 0 10px; color: var(--el-color-danger); font-size: 12px; }

.composer-hint {
  color: var(--chat-muted);
  font-size: 11px;

  @media (max-width: 767px) {
    font-size: 10px;
  }
}

.send-button {
  flex: 0 0 34px;
  width: 34px;
  height: 34px;
  padding: 0;
  border-radius: 10px;
  font-size: 19px;
  --el-button-text-color: var(--chat-on-accent);
  --el-button-hover-text-color: var(--chat-on-accent);
  --el-button-active-text-color: var(--chat-on-accent);

  &.is-disabled {
    color: var(--chat-disabled-text);
    background: var(--chat-disabled-background);
    border-color: var(--chat-disabled-background);
  }
}

.composer-footer {
  margin-top: 12px;
  text-align: center;
  color: var(--chat-subtle);
  font-size: 11px;
  letter-spacing: 0.5px;
}
</style>
