// 导入路由模块
import { createRouter, createWebHistory } from 'vue-router'

// Layout 负责公共页面框架，子路由负责切换主内容区。
// 路由层面的按需加载
const routes = [
  {
    path: '/',
    component: () => import('../layout/ChatLayout.vue'),
    children: [
      {
        path: '',
        redirect: { name: 'ai' }
      },
      {
        path: 'ai',
        name: 'ai',
        component: () => import('../views/ChatView.vue')
      }
    ]
  },
  {
    path: '/:pathMatch(.*)*',
    redirect: '/ai'
  }
]

// 创建路由实例
const router = createRouter({
  history: createWebHistory(),
  routes
})

export default router
