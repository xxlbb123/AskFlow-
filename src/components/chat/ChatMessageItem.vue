<script setup>
import { ref } from 'vue'
import { ChatDotRound, User } from '@element-plus/icons-vue'
import MarkdownContent from '../common/MarkdownContent.vue'
import CopyButton from '../common/CopyButton.vue'
import AttachmentList from './attachments/AttachmentList.vue'
import SourceReferences from './attachments/SourceReferences.vue'

defineProps({ message: { type: Object, required: true } })
const sourceReferences = ref(null)
</script>

<template>
  <article class="message-item" :class="{ 'user-message': message.role === 'user' }">
    <span class="message-avatar" aria-hidden="true">
      <el-icon><User v-if="message.role === 'user'" /><ChatDotRound v-else /></el-icon>
    </span>
    <div class="message-body">
      <p class="message-author">{{ message.role === 'user' ? '你' : 'AI 助手' }}</p>
      <AttachmentList v-if="message.role === 'user'" :attachments="message.attachments" />
      <div v-if="message.role === 'user'" class="message-content plain-text">{{ message.content }}</div>
      <MarkdownContent v-else class="message-content" :content="message.content" :sources="message.sources"
        @select-source="sourceReferences?.openSource($event)" />
      <SourceReferences v-if="message.role === 'assistant'" ref="sourceReferences" :sources="message.sources" :mode="message.documentMode" />
      <div v-if="message.role === 'assistant' && message.content" class="message-actions">
        <CopyButton :text="message.content" label="复制回复" />
      </div>
    </div>
  </article>
</template>

<style scoped lang="scss">
.message-item {
  display: flex;
  align-items: flex-start;
  gap: 14px;
  margin-bottom: 30px;

  &:not(.user-message) {
    .message-body {
      flex: 1;
    }
  }

  // &.user-message 表示同一个元素同时拥有这两个类。
  // 普通消息按照正常方向排列，用户消息反向排列。
  &.user-message {
    flex-direction: row-reverse;

    .message-avatar {
      color: var(--chat-user-avatar-text);
      background: var(--chat-user-avatar-background);
    }

    .message-author {
      text-align: right;
    }

    .message-content {
      padding: 12px 18px;
      border: 1px solid var(--chat-user-border);
      border-radius: 14px 2px 14px 14px;
      background: var(--chat-user-background);
    }
  }
}
.message-avatar {
  display: grid;
  flex: 0 0 32px;
  place-items: center;
  height: 32px;
  border-radius: 10px;
  color: var(--chat-accent);
  background: var(--chat-accent-soft);
  font-size: 18px;
}
.message-body {
  min-width: 0;
  max-width: calc(100% - 46px);
}
.message-author {
  margin: 4px 0 10px;
  color: var(--chat-muted);
  font-size: 12px;
}
.message-content {
  /* 很长的网址,代码字符串等能够换行,避免撑破布局*/
  overflow-wrap: anywhere;
  line-height: 1.75;
  font-size: 15px;

  &.plain-text {
    /* 保留换行和空格 */
    white-space: pre-wrap;
  }
}
.message-actions {
  display: flex;
  align-items: center;
  margin-top: 12px;
}
</style>
