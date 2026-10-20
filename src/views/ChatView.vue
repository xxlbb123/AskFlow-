<script setup>
import { nextTick, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useChatStore } from '../stores/chat.js'
import ChatMessageList from '../components/chat/ChatMessageList.vue'
import ChatComposer from '../components/chat/ChatComposer.vue'

const chatStore = useChatStore()
// storeToRefs 保留解构后的响应性；切换会话时，消息和输入框一起更新。
const { messages, inputMessage, isGenerating, activeSession, activeSessionId, draftVersion } = storeToRefs(chatStore)
const composer = ref(null)
const { pendingAttachments, referenceFile, attachmentError, canSend, generationStatus, canRetryReply } = storeToRefs(chatStore)

const selectPrompt = async (prompt) => {
  inputMessage.value = prompt
  await nextTick()
  composer.value?.focus()
}

// 新建或切换只改变 Store 的当前会话，不再销毁整个聊天页面。
watch([activeSessionId, draftVersion], () => composer.value?.focus(), { flush: 'post' })
</script>

<template>
  <section class="chat-view" aria-label="AI 聊天">
    <ChatMessageList
      :messages="messages"
      :session-id="activeSessionId"
      :is-generating="isGenerating"
      :generation-status="generationStatus"
      @select-prompt="selectPrompt"
    />
    <div v-if="activeSession?.error || canRetryReply" class="chat-error">
      <el-alert :title="activeSession.error || '上次没有收到回复，请重试'" type="error" show-icon :closable="false" />
      <el-button v-if="canRetryReply" class="retry-reply" native-type="button" type="primary" plain @click="chatStore.retryLastReply">重试回复</el-button>
    </div>
    <ChatComposer
      ref="composer"
      v-model="inputMessage"
      :is-generating="isGenerating"
      :attachments="pendingAttachments"
      :reference-file="referenceFile"
      :attachment-error="attachmentError"
      :can-send="canSend"
      @attach="chatStore.addAttachment"
      @remove-attachment="chatStore.removeAttachment"
      @retry-attachment="chatStore.retryAttachment"
      @attachment-error="chatStore.setAttachmentError"
      @send="chatStore.sendMessage"
    />
  </section>
</template>

<style scoped lang="scss">
.chat-view {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.chat-error {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
  width: 100%;
  max-width: calc(var(--chat-content-width) + 2 * var(--chat-gutter));
  margin: 0 auto;
  padding: 0 var(--chat-gutter);
  :deep(.el-alert) { flex: 1; min-width: 0; }
  .retry-reply { flex-shrink: 0; }
}
</style>
