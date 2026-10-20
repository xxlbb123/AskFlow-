import { ref, watch } from 'vue'
import { defineStore } from 'pinia'
// 这个是保存到localStorage时候使用的键名
export const THEME_STORAGE_KEY = 'ai-chat-theme'
// 确定页面打开时应该使用哪一种主题
const readInitialTheme = () => {
  if (typeof window === 'undefined') return 'light'

  try {
    const savedTheme = window.localStorage.getItem(THEME_STORAGE_KEY)
    if (savedTheme === 'light' || savedTheme === 'dark') return savedTheme
  } catch {
    // 浏览器禁用本地存储时，仍然可以在当前页面切换主题。
  }

  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export const useThemeStore = defineStore('theme', () => {
  // theme变量 保存当前主题；只允许两种值:'light'和'dark'
  // localStorage 负责刷新后恢复。
  const theme = ref(readInitialTheme()) //相当于是state

  watch(theme, (value) => {
    if (typeof document !== 'undefined') {
      const root = document.documentElement //取得页面的根元素<html>
      // Element Plus 和自定义 SCSS 共用 html.dark 作为夜间主题入口。
      root.classList.toggle('dark', value === 'dark') //会按照第二个参数布尔值决定类名是否存在

      root.dataset.theme = value //设置data-theme="light"或者 "dark"，标记当前主题
      root.style.colorScheme = value //告诉浏览器采用对应的原生控件、滚动条等配色
      // 查找meta元素，然后使用setAttribute修改属性
      document.querySelector('meta[name="theme-color"]')
        ?.setAttribute('content', value === 'dark' ? '#141b1a' : '#ffffff')
    }

    try {
      if (typeof window !== 'undefined') window.localStorage.setItem(THEME_STORAGE_KEY, value)
    } catch {
      // 存储失败只影响下次访问的恢复，不影响本次切换。
    }
  }, { immediate: true, flush: 'sync' })
  // 设置主题
  const setTheme = (value) => {
    if (value === 'light' || value === 'dark') theme.value = value
  }
  // 切换主题
  const toggleTheme = () => setTheme(theme.value === 'dark' ? 'light' : 'dark')

  return { theme, setTheme, toggleTheme }
})
