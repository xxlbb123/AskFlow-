import { createApp } from 'vue'
import App from './App.vue'

// 【新增：导入路由配置】
import router from './router'

// 【新增：导入Element Plus组件库】
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'
import 'element-plus/theme-chalk/dark/css-vars.css'
import 'vue-virtual-scroller/index.css'
import './styles/tailwind.css'
import './styles/main.scss'
import { createPinia } from 'pinia'
import piniaPluginPersistedstate from 'pinia-plugin-persistedstate'
import { useThemeStore } from './stores/theme.js'
import { useChatStore } from './stores/chat.js'
// 创建Vue应用实例
const app = createApp(App)

// 使用pinia来进行状态管理
const pinia = createPinia()
pinia.use(piniaPluginPersistedstate)
app.use(pinia)
// 在挂载组件前恢复主题，切换按钮和页面共用这个 Store。
useThemeStore(pinia)

const chatStore = useChatStore(pinia)
// 离开页面前保存最新文字和草稿；其余变化由持久化插件自动监听。
window.addEventListener('beforeunload', () => chatStore.$persist())
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') chatStore.$persist()
})

// 【新增：使用路由】
app.use(router)
// 【新增：使用Element Plus组件库】
app.use(ElementPlus)

// 挂载应用
app.mount('#app')
