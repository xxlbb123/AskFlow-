<script setup>
import { ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useRouter } from 'vue-router'
import { Expand } from '@element-plus/icons-vue'
import { ElMessageBox } from 'element-plus'
import ChatSidebar from '../components/chat/ChatSidebar.vue'
import ThemeToggle from '../components/common/ThemeToggle.vue'
import { useChatStore } from '../stores/chat.js'

const router = useRouter()
const sidebarOpen = ref(false)
const chatStore = useChatStore()
const { orderedSessions, activeSessionId, activeSession, storageError } = storeToRefs(chatStore)

const startNewChat = async () => {
  await router.push({ name: 'ai' })
  chatStore.startNewChat()
  sidebarOpen.value = false
}

const selectSession = async (id) => {
  await router.push({ name: 'ai' })
  chatStore.selectSession(id)
  sidebarOpen.value = false
}

const deleteSession = async (id) => {
  const session = chatStore.sessions.find(item => item.id === id)
  if (!session) return
  try {
    await ElMessageBox.confirm(`确定删除“${session.title}”及其聊天记录吗？`, '删除会话', {
      confirmButtonText: '删除', cancelButtonText: '取消', type: 'warning'
    })
  } catch { return }
  chatStore.deleteSession(id)
}
</script>

<template>
  <div class="chat-layout">
    <aside class="desktop-sidebar" aria-label="聊天导航">
      <ChatSidebar
        :sessions="orderedSessions"
        :active-session-id="activeSessionId"
        @new-chat="startNewChat"
        @select-session="selectSession"
        @delete-session="deleteSession"
      />
    </aside>
    <!-- 移动端抽屉 -->
    <el-drawer
      v-model="sidebarOpen"
      title="聊天导航"
      direction="ltr"
      size="268px"
      :with-header="false"
      class="mobile-sidebar-drawer"
    >
      <ChatSidebar
        closable
        :sessions="orderedSessions"
        :active-session-id="activeSessionId"
        @new-chat="startNewChat"
        @select-session="selectSession"
        @delete-session="deleteSession"
        @close="sidebarOpen = false"
      />
    </el-drawer>

    <div class="chat-main">
      <header class="chat-header">
        <div class="header-title">
          <el-button
            class="sidebar-toggle"
            text
            :icon="Expand"
            aria-label="打开聊天导航"
            :aria-expanded="sidebarOpen"
            @click="sidebarOpen = true"
          />
          <h1 class="tw:truncate" :title="activeSession?.title">{{ activeSession?.title || '新对话' }}</h1>
          <span class="header-divider" aria-hidden="true"></span>
          <span class="header-caption">思考、创作，一起完成</span>
        </div>
        <div class="header-actions tw:flex tw:items-center tw:gap-2">
          <span class="header-tag">你的智能助手</span>
          <ThemeToggle />
        </div>
      </header>
      <el-alert v-if="storageError" class="storage-error" :title="storageError" type="warning" show-icon :closable="false" />
      <main class="chat-content">
        <router-view />
      </main>
    </div>
  </div>
</template>

<style scoped lang="scss">
.chat-layout {
  display: flex;
  width: 100%;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  background: var(--chat-background);
}

.desktop-sidebar {
  flex: 0 0 260px;
  min-width: 0;
  min-height: 0;
  border-right: 1px solid var(--chat-border);

  @media (max-width: 767px) {
    display: none;
  }
}

.chat-main {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}

.chat-content {
  display: flex;
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.storage-error {
  flex-shrink: 0;
}

.chat-header {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  height: 72px;
  padding: 0 var(--chat-gutter);
  border-bottom: 1px solid var(--chat-border);
  background: var(--chat-surface);

  @media (max-width: 767px) {
    height: 60px;
    gap: 8px;
  }
}

.header-title {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 16px;
  min-width: 0;

  h1 {
    min-width: 0;
    font-size: 16px;
    font-weight: 600;
  }

  @media (max-width: 767px) {
    gap: 8px;
  }
}

.header-divider {
  flex-shrink: 0;
  height: 16px;
  width: 1px;
  background: var(--chat-border);
}

.header-caption {
  flex-shrink: 0;
  color: var(--chat-muted);
  font-size: 13px;
}

.header-caption,
.header-divider {
  @media (max-width: 767px) {
    display: none;
  }
}

.header-tag {
  flex-shrink: 0;
  padding: 5px 11px;
  border-radius: 6px;
  color: var(--chat-accent);
  background: var(--chat-accent-soft);
  font-size: 12px;

  @media (max-width: 480px) {
    display: none;
  }
}

.header-actions {
  flex-shrink: 0;
}

.sidebar-toggle {
  display: none;

  @media (max-width: 767px) {
    display: inline-flex;
    flex-shrink: 0;
    width: 36px;
    height: 36px;
    padding: 8px;
    font-size: 20px;
  }
}
</style>
