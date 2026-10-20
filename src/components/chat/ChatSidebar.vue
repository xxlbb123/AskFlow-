<script setup>
import { ChatDotRound, ChatLineSquare, Close, Delete, Loading, Plus } from '@element-plus/icons-vue'

defineProps({
  closable: Boolean,
  sessions: { type: Array, default: () => [] },
  activeSessionId: { type: String, default: null }
})
defineEmits(['new-chat', 'select-session', 'delete-session', 'close'])
</script>

<template>
  <div class="chat-sidebar">
    <div class="sidebar-brand">
      <span class="brand-mark"><el-icon><ChatDotRound /></el-icon></span>
      <span class="brand-name">AI 聊天</span>
      <el-button
        v-if="closable"
        class="close-sidebar"
        text
        :icon="Close"
        aria-label="关闭聊天导航"
        @click="$emit('close')"
      />
    </div>
    <el-button class="new-chat-button" :icon="Plus" @click="$emit('new-chat')">
      新建聊天
    </el-button>
    <section class="chat-history" aria-label="历史会话">
      <h2>历史会话</h2>
      <ul v-if="sessions.length" class="session-list" aria-label="会话列表">
        <li v-for="session in sessions" :key="session.id">
          <button
            type="button"
            class="session-button tw:flex tw:items-center tw:gap-2 tw:w-full"
            :class="{ 'is-active': session.id === activeSessionId }"
            :aria-pressed="session.id === activeSessionId"
            :title="session.title"
            @click="$emit('select-session', session.id)"
          >
            <el-icon class="tw:shrink-0"><ChatDotRound /></el-icon>
            <span class="session-title tw:truncate tw:min-w-0 tw:flex-1">{{ session.title }}</span>
            <el-icon v-if="session.isGenerating" class="session-loading tw:shrink-0" aria-hidden="true"><Loading /></el-icon>
            <span v-if="session.isGenerating" class="tw:sr-only">正在回复</span>
          </button>
          <button
            type="button"
            class="session-delete"
            :aria-label="`删除会话：${session.title}`"
            title="删除会话"
            @click.stop="$emit('delete-session', session.id)"
          >
            <el-icon><Delete /></el-icon>
          </button>
        </li>
      </ul>
      <div v-else class="history-empty">
        <el-icon><ChatLineSquare /></el-icon>
        <p>暂无历史对话</p>
        <span>从一个问题开始新的交流</span>
      </div>
    </section>
    <div class="sidebar-footer">
      <span class="footer-mark" aria-hidden="true">AI</span>
      <div>
        <p>灵感，从对话开始</p>
        <span>让想法更进一步</span>
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
.chat-sidebar {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  padding: 28px 20px 20px;
  background: var(--chat-sidebar-background);
}
.sidebar-brand {
  display: flex;
  align-items: center;
  gap: 11px;
  margin-bottom: 32px;
  padding: 0 8px;
  flex-shrink: 0;
}
.brand-mark {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border-radius: 10px;
  background: var(--chat-accent);
  color: var(--chat-on-accent);
  font-size: 21px;
}
.brand-name {
  font-size: 19px;
  font-weight: 700;
  letter-spacing: -0.5px;
}
.close-sidebar {
  margin-left: auto;
  padding: 6px;
}
.new-chat-button {
  justify-content: flex-start;
  flex-shrink: 0;
  width: 100%;
  height: 46px;
  margin: 0 0 32px;
  padding: 0 17px;
  border: 1px solid var(--chat-accent-border);
  border-radius: 10px;
  color: var(--chat-accent);
  background: var(--chat-surface);
  font-size: 14px;
  font-weight: 600;
  box-shadow: var(--chat-button-shadow);

  &:hover {
    border-color: var(--chat-accent);
    background: var(--chat-accent-soft);
  }
}
.chat-history {
  flex: 1;
  min-height: 0;
  overflow-y: auto;

  h2 {
    padding: 0 10px;
    color: var(--chat-muted);
    font-size: 12px;
    font-weight: 500;
    letter-spacing: 1px;
  }
}
.session-list {
  list-style: none;
  padding: 0;
  margin: 14px 0 0;

  li {
    position: relative;

    &:hover,
    &:focus-within {
      .session-delete { opacity: 1; }
    }
  }

  li + li {
    margin-top: 6px;
  }
}
.session-button {
  min-height: 42px;
  padding: 10px;
  padding-right: 38px;
  border: 1px solid transparent;
  border-radius: 9px;
  background: transparent;
  color: var(--chat-text-secondary);
  text-align: left;
  cursor: pointer;

  &:hover {
    background: var(--chat-hover-background);
  }

  &.is-active {
    color: var(--chat-accent);
    background: var(--chat-accent-soft);
    border-color: var(--chat-accent-border);
  }

  .session-title {
    font-size: 13px;
  }

  .session-loading {
    animation: session-spin 1s linear infinite;

    @media (prefers-reduced-motion: reduce) {
      animation: none;
    }
  }
}
.session-delete {
  position: absolute;
  top: 50%;
  right: 5px;
  transform: translateY(-50%);
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--chat-muted);
  cursor: pointer;
  opacity: 0;

  &:hover,
  &:focus-visible {
    background: var(--chat-hover-background);
    color: var(--chat-text);
  }

  @media (hover: none) { opacity: 1; }
}
@keyframes session-spin {
  to { transform: rotate(360deg); }
}
.history-empty {
  padding: 42px 0;
  text-align: center;

  > .el-icon {
    margin-bottom: 13px;
    color: var(--chat-subtle);
    font-size: 26px;
  }

  p {
    margin-bottom: 5px;
    color: var(--chat-muted);
    font-size: 13px;
  }

  span {
    color: var(--chat-subtle);
    font-size: 11px;
  }
}
.sidebar-footer {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  gap: 10px;
  padding: 18px 4px 0;
  border-top: 1px solid var(--chat-border);

  p {
    color: var(--chat-text-secondary);
    font-size: 12px;
  }

  div > span {
    color: var(--chat-subtle);
    font-size: 11px;
  }
}
.footer-mark {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border: 1px solid var(--chat-border);
  border-radius: 50%;
  background: var(--chat-surface);
  color: var(--chat-muted);
  font-size: 11px;
  font-weight: 600;
}
</style>
