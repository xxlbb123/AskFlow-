<script setup>
import { Document, Close } from '@element-plus/icons-vue'
defineProps({ attachment: { type: Object, required: true }, editable: Boolean })
defineEmits(['remove', 'retry'])
const sizeLabel = size => size >= 1024 * 1024 ? `${(size / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.ceil(size / 1024))} KB`
</script>

<template>
  <div class="attachment-card" :class="{ 'has-error': attachment.status === 'error' }">
    <el-icon class="file-icon"><Document /></el-icon>
    <div class="file-info">
      <span class="file-name" :title="attachment.name">{{ attachment.name }}</span>
      <span class="file-detail" role="status">
        {{ sizeLabel(attachment.size) }} · {{ attachment.status === 'uploading' ? '上传并建立索引中…' : attachment.status === 'error' ? '上传失败' : '已就绪' }}
      </span>
      <span v-if="attachment.error" class="file-error">{{ attachment.error }}</span>
    </div>
    <button v-if="editable && attachment.status === 'error'" class="file-action" type="button" @click="$emit('retry', attachment.id)">重试</button>
    <button v-if="editable" class="file-action remove" type="button" :aria-label="`移除 ${attachment.name}`" @click="$emit('remove', attachment.id)">
      <el-icon><Close /></el-icon>
    </button>
  </div>
</template>

<style scoped lang="scss">
.attachment-card {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  max-width: 100%;
  padding: 10px 12px;
  border: 1px solid var(--chat-border-strong);
  border-radius: 10px;
  background: var(--chat-background);
  color: var(--chat-text);
  &.has-error { border-color: var(--el-color-danger); }
  .file-icon { flex-shrink: 0; color: var(--chat-accent); font-size: 23px; }
  .file-info { flex: 1; min-width: 0; }
  .file-name { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; }
  .file-detail { display: block; margin-top: 3px; color: var(--chat-muted); font-size: 11px; }
  .file-error { display: block; margin-top: 4px; color: var(--el-color-danger); overflow-wrap: anywhere; font-size: 12px; }
  .file-action {
    flex-shrink: 0;
    padding: 5px;
    border: 0;
    background: transparent;
    color: var(--chat-accent);
    cursor: pointer;
    font-size: 12px;
    &.remove { display: grid; place-items: center; color: var(--chat-muted); }
    &:focus-visible { outline: 2px solid var(--chat-accent); border-radius: 4px; }
  }
}
</style>
