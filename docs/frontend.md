# 前端开发说明

[返回项目 README](../README.md)

## 代码职责

| 入口 | 职责 |
| --- | --- |
| [ChatLayout.vue](../src/layout/ChatLayout.vue) | 页面框架，连接侧栏与 Store，处理新建和切换会话 |
| [ChatView.vue](../src/views/ChatView.vue) | 将当前会话连接到消息列表和输入组件 |
| [components/chat/](../src/components/chat/) | 侧栏、消息列表、消息项、输入框与附件展示 |
| [components/common/](../src/components/common/) | 可复用的 Markdown、复制按钮和主题切换组件 |
| [stores/chat.js](../src/stores/chat.js) | 会话、草稿、附件、消息发送与生成状态 |
| [stores/theme.js](../src/stores/theme.js) | 日夜主题切换与本地保存 |
| [services/](../src/services/) | 聊天 HTTP 请求、SSE 解析与文件上传 |
| [utils/](../src/utils/) | Markdown 解析、代码高亮、剪贴板与聊天存储 |
| [styles/](../src/styles/) | Tailwind 入口与全局主题 SCSS |

公共组件按职责与业务依赖划分。`MarkdownContent` 和 `CopyButton` 通过 props 接收内容，`ThemeToggle` 使用主题 Store，均不依赖聊天会话状态。

## 一次消息如何流转

1. `ChatComposer` 通过 `v-model` 更新草稿，提交时发出 `send`，由 `ChatView` 调用 `chatStore.sendMessage()`。
2. Store 校验输入；空白聊天在首条有效消息发送时创建会话，以消息前 24 个字符为标题。随后添加用户消息与 AI 占位消息，将消息快照交给请求层。
3. `services/chat.js` 用 `TextDecoder` 解码响应，以缓冲区保留跨网络分块的半行 SSE 数据，并分发新增文字、来源与状态。
4. Store 按请求发起时的会话 ID 和消息 ID 追加回复；流结束后清除生成状态，失败时保留用户消息与已有正文。没有正文时可复用原问题与附件重试。

侧栏按最近发送时间排序。切换会话只改变 `activeSessionId`，请求控制器按会话管理，因此其他会话的生成仍会继续，回复不会写入当前选中的其他会话。删除会话会取消对应的回复和上传。

`/` 和未知路径跳转到 `/ai`。窄屏使用抽屉导航，消息区独立滚动，输入框位于底部。

文件问答先完成 MCP 检索，再返回来源与流式正文。工具调用、向量索引和接口协议见[后端说明](../backend/README.md)。

## 样式约定

- `src/styles/tailwind.css` 由 `@tailwindcss/vite` 编译，只引入主题和工具类，省略 Preflight；不要在 SCSS 中引入 Tailwind 或使用 `@apply`。
- 组件使用 `<style scoped lang="scss">`，负责页面骨架、尺寸、滚动、交互状态和媒体查询；嵌套通常保持在两到三层以内。
- 局部对齐、间距和文字省略使用带 `tw:` 前缀的工具类，如 `tw:flex tw:items-center tw:gap-3`；同一属性尽量只在一处定义。
- 全局主题位于 `src/styles/main.scss`，组件颜色引用 `--chat-*` 变量；`v-html` 生成的元素通过 `:deep()` 设置样式，代码块和表格在局部横向滚动。

调整 Vite 插件或安装依赖后需重启开发服务。开发模式的 Tailwind 响应应包含已生成的工具类；若仍含未处理的 `@tailwind utilities` 或 `@theme`，说明插件未生效，生产构建通过不能代替此检查。

参考：[Tailwind Vite 配置](https://tailwindcss.com/docs/installation/using-vite)、[Tailwind 与预处理器](https://tailwindcss.com/docs/compatibility)、[关闭 Preflight](https://tailwindcss.com/docs/preflight)。

## Markdown 与复制

Store 保存 Markdown 原文，`MarkdownContent.vue` 随流式内容追加重新解析；用户消息按普通文本展示，保留换行和空格。

- **解析与链接**：`html: false`，原始 HTML 按文本展示，并使用 markdown-it 的链接协议校验；链接在新标签页打开，带 `noopener noreferrer`。
- **代码高亮**：优先采用代码围栏的语言标记，未标记时在常用语言中自动识别，未知语言按转义文本展示；支持 Vue/HTML、JS/TS、CSS/SCSS、JSON、Python、SQL、Shell 等。
- **复制内容**：代码块通过事件委托读取 `code.textContent`，保留缩进与换行；“复制回复”复制完整 Markdown 原文。生成中复制的是点击时已有的内容。
- **剪贴板**：使用 `navigator.clipboard.writeText()`，需要 HTTPS 或 localhost，失败时显示提示。

引用编号与本条消息的来源匹配时显示为按钮，点击可展开原文；代码中的标记和不存在的来源编号保留原样。

## 主题与持久化

主题 Store 保存 `light` / `dark`，首次访问参考系统偏好，之后从 `localStorage` 的 `ai-chat-theme` 恢复。`index.html` 在应用加载前恢复主题以减少闪屏；切换时同步更新 HTML 的 `dark` 类、`data-theme`、`color-scheme` 和浏览器主题色。自定义 SCSS 与 Element Plus 共用深色主题入口。

聊天 Store 通过 `pinia-plugin-persistedstate` 保存 `sessions`、`activeSessionId` 和 `newChatDraft`，存储键为 `ai-chat-history-v1`。`utils/chat-storage.js` 负责序列化与恢复，保留消息、引用、草稿和附件关联，过滤空回复、生成状态与临时错误。

刷新会停止原生成请求并保留已收到的文字，没有正文时恢复为可重试状态。已有会话中上传成功的待发送附件也可恢复；空白新聊天的附件、上传中或失败的附件需重新选择。离开页面或切到后台时额外调用 `$persist()` 保存最新状态。

存储被禁用、数据损坏或空间不足时显示提示，内存中的聊天仍可继续；主题存储不可用时，当前页面仍可切换主题。

## 验证范围

根目录的 `npm test` 覆盖会话与上下文隔离、并发流式回复、跨分块解析、附件组件、消息滚动、持久化、主题初始化、Markdown 与剪贴板，并包含本地 HTTP 集成验证。完整验证命令见[项目 README](../README.md#验证与构建)。
