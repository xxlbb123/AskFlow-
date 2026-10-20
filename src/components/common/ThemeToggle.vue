<script setup>
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { Moon, Sunny } from '@element-plus/icons-vue'
import { useThemeStore } from '../../stores/theme.js'

const themeStore = useThemeStore()
const { theme } = storeToRefs(themeStore)
const label = computed(() => theme.value === 'dark' ? '切换到日间主题' : '切换到夜间主题')
</script>

<template>
  <el-button
    class="theme-toggle"
    native-type="button"
    text
    circle
    :icon="theme === 'dark' ? Sunny : Moon"
    :aria-label="label"
    :aria-pressed="theme === 'dark'"
    :title="label"
    @click="themeStore.toggleTheme()"
  />
</template>

<style scoped lang="scss">
.theme-toggle {
  // 这个flex-shrink:0作用是当flex布局的空间不足是，不让这个主题切换按钮参与压缩
  //在flex布局中，子元素的最终宽度可能受到空间分配的影响,设置width并不意味着它绝对不能被压缩
  flex-shrink: 0;
  width: 36px;
  height: 36px;
  padding: 8px;
  color: var(--chat-text-secondary);
  font-size: 18px;

  &:hover {
    color: var(--chat-accent);
    background: var(--chat-hover-background);
  }
}
</style>
