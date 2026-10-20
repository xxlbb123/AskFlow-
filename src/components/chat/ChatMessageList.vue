<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue' //nextTicK用于等待DOM更新 
import { DynamicScroller, DynamicScrollerItem } from 'vue-virtual-scroller'
//这部分负责虚拟列表
import { ChatDotRound, EditPen, Reading, Cpu, Right, ArrowDown } from '@element-plus/icons-vue'
import ChatMessageItem from './ChatMessageItem.vue'
// 接收父组件数据
const props = defineProps({
  messages: { type: Array, default: () => [] },//当前会话的消息数组
  sessionId: { type: String, default: null },//当前会话ID
  isGenerating: Boolean,//AI是否正在生成回复
  generationStatus: { type: String, default: '' }//"正在查阅文件..."等状态文字
})
// 声明对外事件
defineEmits(['select-prompt'])//select-prompt 是点击欢迎页建议问题时发出的事件，父组件收到后会把建议内容填入输入框。

const messageScroller = ref(null) //虚拟列表组件实例保存到 messageScroller.value。$el 取得它的根 DOM 元素，也就是实际发生滚动的容器。
const scrollContainer = () => messageScroller.value?.$el
let scrollFrame = 0  //已经安排的自动滚动任务ID,0表示没有任务
let lastScrollTop = 0 //上一次记录的滚动位置，用于判断方向
let touchY = 0 //上一次手指的纵坐标，用于判断触摸方向
const bottomThreshold = 48 //距底部不超过 48px，视为底部附近

// 用户上滑时立即暂停；向下滚回底部附近或点击按钮后恢复。
const isFollowingLatest = ref(true) //是否允许自动跟随最新消息,使用响应式数据,因为它还决定"回到最新消息"按钮是否显示,其余数据主要是在函数内部使用
// 负责计算什么时候显示“正在思考” 
const waitingForReply = computed(() => props.isGenerating && (
  // at方法是ES2022新增的数组方法，支持负数索引，-1表示最后一个元素，-2表示倒数第二个元素
  props.messages.at(-1)?.role !== 'assistant' || !props.messages.at(-1)?.content
))
const suggestions = [
  { icon: EditPen, title: '写作与表达', description: '让文字更清晰，让想法被看见', prompt: '帮我润色一段文字，让表达更清晰自然。' },
  { icon: Reading, title: '学习与探索', description: '换个角度，理解一个新知识', prompt: '请用通俗易懂的方式，帮我理解一个新概念。' },
  { icon: Cpu, title: '代码与思路', description: '一起拆解问题，找到解决方法', prompt: '我遇到了一个编程问题，请帮我分析解决思路。' }
]
// 根据实际滚动判断是否继续跟随
// 这个函数由模板中的 @scroll.passive="handleScroll" 触发。
const handleScroll = () => {
  const container = scrollContainer() //获取容器
  if (!container) return
  // 计算底部剩余距离
  // scrollTop是已经向上卷走的距离  
  // scrollHeight 整个内容的高度 
  //  clientHeight 可见区域的高度 如果这个distanceToBottom接近0那么就说明到底了
  const distanceToBottom = container.scrollHeight - container.clientHeight - container.scrollTop
  // 先尊重向上阅读的操作，即使还在底部附近也不恢复跟随。
  if (container.scrollTop < lastScrollTop) pauseFollowing() //当前位置比上次的小,正在向上阅读,暂停跟随
  else if (container.scrollTop > lastScrollTop) {
    // 当前位置比上次的大,正在向下滚动,根据是否进入底部48px范围决定跟随
    isFollowingLatest.value = distanceToBottom <= bottomThreshold
  }
  lastScrollTop = container.scrollTop
}
// 停止跟随，并撤销待执行任务
const pauseFollowing = () => {
  isFollowingLatest.value = false
  cancelAnimationFrame(scrollFrame)
  scrollFrame = 0
}

// 在滚动事件发生前暂停，避免排队中的自动滚动把用户拉回去。
const handleWheel = (event) => {
  if (event.deltaY < 0) pauseFollowing() //鼠标滚轮向上时立即暂停
}
// 触摸操作通过手指坐标判断
const handleTouchMove = (event) => {
  const nextY = event.touches[0]?.clientY ?? touchY
  if (nextY > touchY) pauseFollowing()
  touchY = nextY
}
// handleKeydown() 则识别 ArrowUp、PageUp、Home、Shift + 空格，这些向上阅读的键盘操作也会暂停跟随。
const handleKeydown = (event) => {
  if (['ArrowUp', 'PageUp', 'Home'].includes(event.key) || (event.key === ' ' && event.shiftKey)) {
    pauseFollowing()
  }
}

//安排真正的自动滚动。
const scrollToBottom = async () => {
  await nextTick()// 等待Vue将新增消息更新到DOM中
  // 检查是否需要安排滚动 已暂停跟随、已经有滚动任务排队、或者没有容器时，直接返回
  if (!isFollowingLatest.value || scrollFrame || !scrollContainer()) return
  // 使用 requestAnimationFrame() 安排任务 
  //让浏览器在后续绘制前执行滚动，并把返回的任务 ID 保存到 scrollFrame，方便取消。
  // 一开始先登记好任务
  scrollFrame = requestAnimationFrame(() => {
    scrollFrame = 0 // 清楚保存的编号，这个不会真正的取消任务
    const container = scrollContainer()
    //再次检查，因为从“登记任务”到“执行任务”之间，
    // 用户可能已经向上滚动了，或者组件已经离开页面
    if (!isFollowingLatest.value || !container) return 
    // 这里如果超出了最大的滚动位置，那么也会将实际位置限制到最大值
    container.scrollTop = container.scrollHeight //把容器滚动到底部
    lastScrollTop = container.scrollTop //记录实际滚动位置
  })
}
// 恢复跟随
const resumeFollowing = () => {
  isFollowingLatest.value = true
  scrollToBottom()
}

onMounted(scrollToBottom)
onBeforeUnmount(() => cancelAnimationFrame(scrollFrame))
// 决定什么时候调用滚动函数
// watch(
//   监听的数据,
//   数据变化后执行的函数,
//   配置选项
// )
// 只有切换会话时重置；发送消息、流式追加和生成结束都尊重当前阅读位置。
watch(
  () => [props.sessionId, props.messages.length, props.messages.at(-1)?.content, props.isGenerating],
  (current, previous) => {
    // current、previous 分别是这四个值的新数组、旧数组，所以 current[0] 和 previous[0] 比较的是会话 ID。
    if (current[0] !== previous[0]) {
      isFollowingLatest.value = true
      lastScrollTop = scrollContainer()?.scrollTop ?? 0
    }
    scrollToBottom()
  },
  { flush: 'post' }//表示在当前组件 DOM 更新后执行监听回调。
)
</script>

<template>
  <div class="message-panel">
    <div v-if="!messages.length" class="message-scroll is-empty">
      <!-- 欢迎内容 -->
      <div class="chat-welcome">
        <span class="welcome-mark"><el-icon><ChatDotRound /></el-icon></span>
        <p class="welcome-eyebrow">每一个想法，都值得展开</p>
        <h2>有什么我可以帮你？</h2>
        <p class="welcome-description">从一个想法、一个问题，或者一段代码开始。</p>
        <div class="suggestion-grid">
          <button
            v-for="suggestion in suggestions"
            :key="suggestion.title"
            type="button"
            class="suggestion-card"
            @click="$emit('select-prompt', suggestion.prompt)"
          >
            <el-icon class="suggestion-icon"><component :is="suggestion.icon" /></el-icon>
            <span class="suggestion-title">{{ suggestion.title }}<el-icon><Right /></el-icon></span>
            <span class="suggestion-description">{{ suggestion.description }}</span>
          </button>
        </div>
      </div>
    </div>
    <!-- 只渲染可见范围及附近的消息；完整记录仍保留在 Store 中。 -->
     <!-- 计算渲染范围，总高度以及消息的位置 -->
    <DynamicScroller
      v-else
      :key="sessionId || 'new-chat'"
      ref="messageScroller"
      class="message-scroll"
      :items="messages"
      :min-item-size="120" 
      :prerender="8"
      key-field="id"
      role="log"
      aria-label="聊天消息"
      aria-live="polite"
      tabindex="0"
      @scroll.passive="handleScroll"
      @wheel.passive="handleWheel"
      @touchstart.passive="touchY = $event.touches[0]?.clientY ?? 0"
      @touchmove.passive="handleTouchMove"
      @keydown="handleKeydown"
      @pointerdown="$event.target === $event.currentTarget && pauseFollowing()"
      @resize="scrollToBottom"
    >
      <template #default="{ item, index, active }">
        <!-- 测量每条消息的高度，并报告变化 -->
        <DynamicScrollerItem
          :item="item"
          :active="active"
          :index="index"
          :emit-resize="true"
          @resize="scrollToBottom"
        >
          <div class="message-row">
            <ChatMessageItem v-if="item.content" :key="item.id" :message="item" />
            <div v-else-if="waitingForReply && index === messages.length - 1" class="thinking" role="status">
              <span class="thinking-dots" aria-hidden="true"><i></i><i></i><i></i></span>
              <span>{{ generationStatus || '正在思考…' }}</span>
            </div>
          </div>
        </DynamicScrollerItem>
      </template>
      <template #after>
        <div v-if="waitingForReply && messages.at(-1)?.role !== 'assistant'" class="message-row">
          <div class="thinking" role="status">
            <span class="thinking-dots" aria-hidden="true"><i></i><i></i><i></i></span>
            <span>{{ generationStatus || '正在思考…' }}</span>
          </div>
        </div>
      </template>
    </DynamicScroller>
    <button
      v-if="messages.length && !isFollowingLatest"
      class="scroll-latest"
      type="button"
      aria-label="回到最新消息"
      title="回到最新消息"
      @click="resumeFollowing"
    >
      <el-icon><ArrowDown /></el-icon>
    </button>
  </div>
</template>

<style scoped lang="scss">
.message-panel {
  position: relative;
  display: flex;
  flex: 1;
  min-width: 0;
  min-height: 0;
}

.message-scroll {
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  overflow-anchor: none;
  padding: 32px var(--chat-gutter) 16px;

  &.is-empty {
    display: flex;
  }

  @media (max-width: 767px) {
    padding-top: 24px;
    padding-bottom: 12px;
  }
}
.scroll-latest {
  position: absolute;
  bottom: 16px;
  left: 50%;
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  transform: translateX(-50%);
  border: 1px solid var(--chat-border);
  border-radius: 50%;
  background: var(--chat-surface);
  color: var(--chat-text-secondary);
  box-shadow: 0 3px 12px rgb(0 0 0 / 10%);
  cursor: pointer;

  &:hover {
    border-color: var(--chat-accent-border-hover);
    color: var(--chat-accent);
  }

  &:focus-visible {
    outline: 2px solid var(--chat-accent);
    outline-offset: 3px;
  }

  .el-icon {
    font-size: 18px;
  }

  @media (max-width: 767px) {
    bottom: 12px;
  }
}
.chat-welcome {
  width: 100%;
  max-width: var(--chat-content-width);
  margin: auto;
  padding: 26px 0 38px;
  text-align: center;

  h2 {
    font-size: clamp(25px, 2.7vw, 36px);
    font-weight: 600;
    letter-spacing: -1px;
    line-height: 1.4;
  }

  @media (max-width: 767px) {
    padding: 16px 0 24px;
  }
}
.welcome-mark {
  display: inline-grid;
  place-items: center;
  width: 60px;
  height: 60px;
  margin-bottom: 23px;
  border: 1px solid var(--chat-accent-border);
  border-radius: 19px;
  background: var(--chat-accent-soft);
  color: var(--chat-accent);
  font-size: 32px;
}
.welcome-eyebrow {
  margin-bottom: 12px;
  color: var(--chat-accent);
  font-size: 12px;
  letter-spacing: 2px;
}
.welcome-description {
  margin-top: 14px;
  color: var(--chat-muted);
  font-size: 14px;

  @media (max-width: 767px) {
    font-size: 13px;
  }
}
.suggestion-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px;
  margin-top: 42px;

  @media (max-width: 1000px) {
    gap: 10px;
  }

  @media (max-width: 767px) {
    grid-template-columns: 1fr;
    margin-top: 26px;
  }
}
.suggestion-card {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 12px;
  min-width: 0;
  padding: 21px 18px;
  border: 1px solid var(--chat-border);
  border-radius: 12px;
  background: var(--chat-surface);
  text-align: left;
  cursor: pointer;
  transition: border-color 150ms, background 150ms, transform 150ms;

  &:hover {
    transform: translateY(-2px);
    border-color: var(--chat-accent-border-hover);
    background: var(--chat-suggestion-hover);
  }

  @media (max-width: 1000px) {
    padding: 17px 12px;
  }

  @media (max-width: 767px) {
    flex-direction: row;
    align-items: center;
    padding: 15px 16px;
  }

  @media (prefers-reduced-motion: reduce) {
    transition: none;
  }
}
.suggestion-icon {
  font-size: 20px;
  color: var(--chat-accent);

  @media (max-width: 767px) {
    flex-shrink: 0;
  }
}
.suggestion-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  color: var(--chat-text);
  font-size: 14px;
  font-weight: 500;

  > .el-icon {
    color: var(--chat-subtle);
  }
}
.suggestion-description {
  color: var(--chat-muted);
  font-size: 12px;
  line-height: 1.6;

  @media (max-width: 767px) {
    display: none;
  }
}
.message-row {
  // 包含消息的下外边距，让虚拟列表测量到完整高度。
  display: flow-root;
  width: 100%;
  max-width: var(--chat-content-width);
  margin: 0 auto;
}
.thinking {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 0 0 24px 46px;
  color: var(--chat-muted);
  font-size: 13px;
}
.thinking-dots {
  display: flex;
  gap: 4px;

  i {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: var(--chat-accent);
    animation: pulse 1.2s infinite ease-in-out;

    &:nth-child(2) {
      animation-delay: 0.15s;
    }

    &:nth-child(3) {
      animation-delay: 0.3s;
    }

    @media (prefers-reduced-motion: reduce) {
      animation: none;
    }
  }
}
@keyframes pulse {
  0%, 80%, 100% {
    opacity: 0.35;
  }
  40% {
    opacity: 1;
  }
}
</style>
