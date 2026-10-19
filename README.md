<img width="2878" height="1686" alt="image" src="https://github.com/user-attachments/assets/2cb94414-5e52-4941-957f-ffcb6c78642f" />
改三个地方，<img width="484" height="92" alt="QQ_1772809677178" src="https://github.com/user-attachments/assets/f5ae93b0-2d1f-413d-8e05-4a90caf58aee" />
<img width="1250" height="510" alt="QQ_1772809690100" src="https://github.com/user-attachments/assets/fab00fef-356c-408a-beaf-137fe1c83663" />
然后<img width="1776" height="738" alt="QQ_1772809705656" src="https://github.com/user-attachments/assets/a758d347-b4f6-4d60-ae18-a3f70bb47b3c" />


# AI聊天应用教程

这是一个基于 Vue 3 + Node.js 构建的 AI 聊天应用教学项目，通过火山方舟调用聊天模型和豆包向量模型，支持流式对话和 TXT/MD 文件的语义检索问答。

## 技术栈

### 前端
- Vue 3 (Composition API)
- Vite
- Element Plus
- Pinia（会话与消息状态）
- Vue Router
- Tailwind CSS 4（常用布局工具类）
- SCSS（组件细节与全局主题）
- markdown-it（AI 回复的 Markdown 渲染）
- highlight.js（代码语法高亮）

### 后端
- Node.js
- Express 5
- 原生 Fetch / Web Streams
- dotenv
- 官方 MCP 客户端与服务端 SDK（文档检索工具）

### AI服务
- 火山方舟聊天模型（由 `backend/.env` 中的 `ARK_MODEL_ID` 配置）
- 豆包向量模型（默认 `doubao-embedding-vision-251215`，使用 1024 维文本向量）

## 项目架构

```
├── backend/          # 后端服务
│   ├── index.js     # 主服务器文件
│   ├── package.json # 后端依赖
│   └── .env         # 环境变量配置
├── src/             # 前端代码
│   ├── layout/      # 聊天页面框架
│   │   └── ChatLayout.vue
│   ├── router/      # 路由：/ 跳转 /ai
│   ├── views/       # 页面组件
│   │   └── ChatView.vue # AI聊天页面
│   ├── components/   # 页面共用组件与聊天业务组件
│   │   ├── common/  # 复制按钮、Markdown 展示和主题切换
│   │   └── chat/    # 侧栏、消息列表、消息项和输入框
│   ├── stores/chat.js # 会话、消息、草稿和生成状态
│   ├── stores/theme.js # 日夜主题状态与本地持久化
│   ├── services/chat.js # 聊天请求与 SSE 流式解析
│   ├── styles/      # 独立 Tailwind 入口与全局 SCSS
│   ├── main.js      # 前端入口
│   └── App.vue      # 根组件
├── tests/chat.test.js # 会话管理与流式解析测试
├── index.html       # HTML模板
├── package.json     # 前端依赖
└── vite.config.js   # Vite配置
```

## 核心功能

当前聊天界面已拆分为独立布局和展示组件。`/` 与未知路径会跳转到 `/ai`；
窄屏使用抽屉导航，消息区独立滚动，输入框位于底部。
点击“新建聊天”进入空白页，发送第一条有效消息时才创建会话，并用消息的前 24 个字符作为侧栏标题。
侧栏按最近发送时间排列，点击标题可切换会话；继续发送消息会沿用当前会话。
每个已有会话保存独立的输入草稿、消息、错误提示和生成状态，切换时未完成的回复仍写入原会话。
会话通过 `pinia-plugin-persistedstate` 保存到浏览器 `localStorage`（键名 `ai-chat-history-v1`），包含消息、引用原文、输入草稿和附件关联，刷新后恢复当前会话。侧栏悬停或键盘聚焦时显示删除按钮，触屏始终显示；确认后删除会话，正在执行的回复或上传会取消。最后一个会话也可删除，删除当前会话后回到空白聊天。
日夜主题可通过右上角的太阳/月亮按钮切换，主题选择已独立保存到 `localStorage`，刷新或重新打开浏览器后会恢复。

1. **实时流式对话**：与AI模型进行实时的流式交互，逐字显示回复内容
2. **消息历史管理**：自动维护对话历史，支持上下文理解
3. **响应式UI设计**：适配不同屏幕尺寸的现代化界面
4. **优雅的错误处理**：完善的错误提示和边界情况处理
5. **文本文件问答**：点击输入框的附件按钮或拖入 UTF-8 编码的 TXT/MD（最大 2 MB，每个会话一个文件），发送问题后可以连续追问；回答下方可展开原文来源。上传失败支持移除、重试。

上传附件不会创建侧栏会话，发送第一条有效问题后才关联会话。上传时会调用向量模型建立索引，不调用聊天模型；文件在后端保存原文件、分块和向量 JSON，可跨后端重启保留。已有会话保存附件 ID 与范围标识，刷新后可继续追问。空白新聊天中未发送的附件需重新选择。文件问答使用余弦相似度检索；全文分层总结、CSV/JSON、PDF/Word 后续实现。当前只解析 TXT/MD，向量模型名称包含 vision 不表示应用已支持图片或 PDF。后端结构、接口和限制见 [backend/README.md](backend/README.md)。

AI 流结束但没有正文时会显示错误和“重试回复”；重试复用原问题与附件。输出达到长度上限或连接提前断开时会明确提示，已有正文仍保留。

文档使用固定窗口切分（900 字符，相邻窗口重叠 160 字符），保存原文行号和起始章节信息。MCP 提供导入、列表、批量搜索和按分块读取四个工具；上传由程序直接调用导入工具，聊天开始时由程序取得文件元数据，模型只使用搜索和读取两个工具。工具决策使用完整 JSON，在最多 3 轮的循环中选择工具、直接执行并按调用 ID 回填，不维护工具调用缓存；聊天流程合并重复原文、统一引用编号及资料预算，随后单独请求流式回答。应用内 MCP 自动启动，同时提供供其他客户端使用的 stdio 入口，详情见后端说明。

上传时每批最多 4 个分块并行生成语料向量，全部成功后才返回“已就绪”。检索时每个去重问题生成查询向量，按余弦相似度取正相似的前 4 块；多个问题轮流选择原文，共享预算并去重。只有所有分块实际入选时才标记 `full`，预算够大也不会自动发送全文。向量只保留在后端，提供给聊天模型和前端的是原文与来源位置。

新文件保存为 version=3。已有 version=1/2 文档仍可读取元数据和分块，但没有兼容向量时搜索会返回 `DOCUMENT_REINDEX_REQUIRED`；请新建聊天并重新上传，当前会话不能替换已发送附件。更换向量模型、维度或检索指令版本后也需要重新上传，不自动重建索引。

## 前置条件

- Node.js 22.12+ 环境
- 火山方舟账号及已经开通的聊天、向量模型服务
- Git (可选)

## 快速开始

### 1. 克隆项目

```bash
git clone <repository-url>
cd yuan-chat-vue
```

### 2. 配置环境变量

在 `backend/` 目录下创建 `.env` 文件：

```env
# 火山方舟 API Key 和模型 ID（也可以直接参考 backend/.env.example）
ARK_API_KEY=your-api-key-here
ARK_MODEL_ID=your-enabled-model-id

# 文档向量模型，沿用同一 API Key 和方舟地址
ARK_EMBEDDING_MODEL_ID=doubao-embedding-vision-251215
ARK_EMBEDDING_DIMENSIONS=1024

# 上传并建立向量索引的总期限，默认 5 分钟
FILE_PROCESSING_TIMEOUT_MS=300000

# 服务器端口
PORT=3000
```

### 3. 安装依赖

#### 前端依赖
```bash
npm install
```

#### 后端依赖
```bash
cd backend
npm install
cd ..
```

### 4. 启动服务

#### 启动后端服务
```bash
cd backend
npm run dev
```

后端服务将运行在 `http://localhost:3000`

#### 启动前端服务
在新的终端窗口中：
```bash
npm run dev
```

前端应用将运行在 `http://localhost:5173`

### 5. 访问应用

打开浏览器访问 `http://localhost:5173`，即可开始与AI聊天！

## 核心代码解析

### 后端职责划分

| 文件 | 职责 |
| --- | --- |
| `backend/index.js` | 读取配置、启动监听和处理启动失败 |
| `backend/src/app.js` | 创建 Express 应用、注册跨域、JSON 解析和路由 |
| `controllers/chat.controller.js` | 校验聊天输入、输出 SSE、处理超时和取消 |
| `services/chat.service.js` | 组织模型规划、MCP 批量检索、补查和最终回答 |
| `services/document.service.js` | 解析、切分、建立向量索引和保存文档，提供读取及检索 |
| `mcp/document.client.js` | 发现 MCP 工具、校验参数和执行调用 |
| `mcp/document.server.js` | 注册四个文档工具，声明输入输出并约束附件范围 |
| `tools/model.tools.js` | 将 MCP 定义转换为模型工具格式，检查调用 ID 和格式 |
| `documents/retrieve.js` | 余弦相似度排序、多问题的共享预算和去重 |
| `documents/evidence.js` | 合并工具返回的原文，统一引用编号及总预算 |
| `clients/ark.client.js` | 请求方舟的 JSON 或流式响应 |
| `clients/embedding.client.js` | 请求豆包文本向量，区分语料与查询指令 |
| `utils/chat-stream.js` | 检查 SSE 正文、结束标记、截断和连接异常 |

文件聊天由 `HTTP 请求 → 非流式工具决策与 MCP 检索循环 → 流式回答` 组成。检索与补查先完成，来源和生成状态在最终 SSE 流开始时发送；正文阶段只负责回答。详细接口及配置见 [backend/README.md](backend/README.md)。

上传处理的后端与 MCP 总期限默认 5 分钟，前端上传等待也是 5 分钟；单次向量 HTTP 请求仍受 `ARK_REQUEST_TIMEOUT_MS` 限制。接口连通性和真实召回效果需使用已开通的向量模型实际验证；项目测试使用模拟响应，不消费模型额度。目前向量保存在文件 JSON 中，没有接入向量数据库、重排或混合检索。

向量请求与 Query/Corpus 指令分别参考[火山方舟多模态向量化 API](https://docs.volcengine.com/docs/ark/multimodal-vectorization-api?lang=zh)和[向量化使用说明](https://docs.volcengine.com/docs/ark/vectorization?lang=zh)。

### 前端职责划分

| 文件 | 职责 |
| --- | --- |
| `ChatLayout.vue` | 页面框架，连接侧栏与 Store，处理新建和切换操作 |
| `ChatSidebar.vue` | 展示标题列表、选中状态和生成状态，通过事件通知父组件 |
| `ChatView.vue` | 将当前会话的数据连接到消息列表和输入组件 |
| `ChatMessageList.vue` | 消息列表、空状态、等待提示和滚动定位 |
| `ChatMessageItem.vue` | 单条消息的头像、角色布局，以及用户文本与 AI Markdown 的展示入口 |
| `common/MarkdownContent.vue` | Markdown 渲染和正文、列表、代码块、表格的排版，可供其他页面复用 |
| `common/CopyButton.vue` | 文本复制按钮、成功反馈和重复点击控制，可供其他页面复用 |
| `ChatComposer.vue` | 输入框、提交按钮及输入事件 |
| `common/ThemeToggle.vue` | 全局主题切换按钮、图标和可访问标签 |
| `stores/chat.js` | 创建会话、生成标题、切换会话、保存草稿和发送消息 |
| `stores/theme.js` | 当前日夜主题、主题切换及本地保存 |
| `services/chat.js` | HTTP 请求与 SSE 解析，通过 `onDelta` 返回新增文字 |
| `utils/markdown.js` | Markdown 解析配置、链接行为和表格滚动容器 |
| `utils/highlight.js` | 常见代码语言高亮、Vue 别名和语言自动识别 |
| `utils/clipboard.js` | 调用浏览器剪贴板接口，保留复制内容原文 |

公共组件放在 `components/common`，聊天业务组件放在 `components/chat`。按组件职责和业务依赖划分目录，而不是按当前在哪个页面使用划分：`CopyButton` 和 `MarkdownContent` 通过 props 接收内容，`ThemeToggle` 使用全局主题 Store；它们都不依赖聊天会话状态。

#### 一次发送如何流转

1. `ChatComposer` 通过 `v-model` 更新当前草稿，提交表单时发出 `send`。
2. `ChatView` 调用 `chatStore.sendMessage()`。
3. Store 校验内容；若当前是空白页，创建会话并生成标题，侧栏立即更新。
4. Store 添加用户消息和 AI 占位消息，再把当前会话的消息快照交给请求层。
5. 请求层用 `TextDecoder` 解码字节，以 `buffer` 保留跨网络分块的半行数据。
6. 每次解析出新增文字，Store 根据发送时保存的会话 ID 和消息 ID 更新对应回复。
7. Vue 响应式更新消息列表；收到结束标记后，Store 清除该会话的生成状态。

切换会话只改变 `activeSessionId`，无需通过 `key` 销毁、重建聊天页面。请求控制器按会话存放，切换时不会中断其他会话的回复。

#### SCSS 与 Tailwind 的使用约定

Tailwind 的入口是 `src/styles/tailwind.css`，由 `@tailwindcss/vite` 编译；组件使用 `<style scoped lang="scss">`，全局主题位于 `src/styles/main.scss`。

- 页面骨架、侧栏尺寸、消息区滚动和输入框位置由组件 SCSS 负责。
- 组件内部的子元素、交互状态和媒体查询就近嵌套，使用 `&:hover`、`&.is-active` 等写法，通常保持两到三层以内。
- 局部对齐、间距、文字省略使用带 `tw:` 前缀的工具类，例如输入框工具栏的 `tw:flex tw:items-center tw:justify-between tw:gap-3`。
- 同一个元素的同一个样式属性尽量只在一处定义，方便追踪样式来源。
- Tailwind 入口保持普通 CSS，独立于 Sass 编译；不在 SCSS 中引入 Tailwind 或使用 `@apply`。
- 只引入 Tailwind 的主题和工具类，不引入 Preflight 全局重置，保留现有 Element Plus 和全局基础样式。

例如 `ChatComposer.vue` 中的嵌套样式：

```scss
.composer {
  &:focus-within {
    border-color: #8dbbb2;
  }

  :deep(.el-textarea__inner) {
    background: transparent;

    &::placeholder {
      color: #949ea6;
    }
  }
}
```

调整 Vite 插件或安装样式依赖后，需要重启开发服务。开发模式的 Tailwind 响应应包含已生成的工具类；如果仍含有未处理的 `@tailwind utilities` 或 `@theme`，说明插件没有生效，生产构建通过也不能代替这项检查。

#### Markdown 回复展示

AI 回复通过 `MarkdownContent.vue` 展示，支持标题、粗体、斜体、有序与无序列表、引用、链接、行内代码、代码块、表格和图片。用户消息继续作为普通文本展示，保留输入中的换行和空格。

Store 保存原始 Markdown 文本；流式追加 `message.content` 时，组件的计算属性重新解析内容。解析器设置 `html: false`，原始 HTML 按文本展示，并沿用 markdown-it 的链接协议校验；链接在新标签页打开并设置 `noopener noreferrer`。

Markdown 的排版集中在组件的嵌套 SCSS 中，通过 `:deep()` 覆盖 `v-html` 生成的元素，并复用现有日夜主题变量。代码块和表格支持局部横向滚动，避免撑宽页面。

代码块使用 highlight.js 的常见语言集合，支持 JavaScript、TypeScript、Vue/HTML、CSS/SCSS、JSON、Python、SQL、Shell 等语言。优先使用代码围栏中的语言标记，未标记时在常用语言中自动识别；未知语言按转义后的普通代码展示。高亮颜色来自日夜主题变量，流式输出中尚未完整的代码也会重新高亮。

代码块顶部的「复制代码」通过事件委托处理，读取当前块的 `code.textContent`，仅复制代码，保留缩进与换行，不包含工具栏、围栏或高亮标签。每条 AI 回复底部的「复制回复」复制完整 Markdown 原文；生成过程中点击则复制点击时已有的内容，后续文字继续追加时恢复按钮状态。

复制使用 `navigator.clipboard.writeText()`，适用于 HTTPS 或 localhost 开发环境；失败时显示提示。回复复制成功后短暂显示「已复制」，代码复制成功后显示消息提示。

#### 日夜主题与持久化

`stores/theme.js` 使用 Setup Store 保存 `theme`（`light` / `dark`），`setTheme()` 和 `toggleTheme()` 是操作方法。切换方法直接判断 `theme.value === 'dark'`，主题按钮通过 `storeToRefs()` 获取 `theme`，据此设置图标、提示文字和可访问状态。

首次访问参考系统的明暗偏好；之后从 `localStorage` 的 `ai-chat-theme` 键恢复主题。监听主题变化时，同步更新 `<html>` 的 `dark` 类、`data-theme`、`color-scheme` 和浏览器主题色，再保存选择。存储不可用时，当前页面仍可正常切换。

`index.html` 在应用加载前先恢复主题，减少深色页面刷新时的白色闪屏。组件的颜色统一引用 `main.scss` 中的 `--chat-*` 变量，`:root.dark` 覆盖夜间配色；Element Plus 引入官方深色变量，同步适配输入框、按钮、提示和抽屉。

主题数据和会话数据分别管理。主题沿用现有保存方式；聊天 Store 的 `persist` 配置选择 `sessions`、`activeSessionId` 和 `newChatDraft`，由插件自动监听变化并写入 `localStorage`。`utils/chat-storage.js` 整理保存和恢复的数据，过滤空回复、生成状态和临时错误；已有会话中已上传成功的待发送附件也可恢复，上传中或失败的附件需重新选择。

刷新会停止原来的生成请求；已收到的文字保留，没有正文时恢复为可重试的用户消息。离开页面或切到后台时额外调用 `$persist()` 保存最新状态。存储被禁用、数据损坏或空间不足时，页面显示提示，内存中的聊天仍可继续。记录保存在当前浏览器，不自动跨设备同步；删除会话会更新本地记录，后端上传文件的磁盘清理由后续文件管理接口处理。

参考：[Tailwind Vite 配置](https://tailwindcss.com/docs/installation/using-vite)、[Tailwind 与预处理器](https://tailwindcss.com/docs/compatibility)、[关闭 Preflight](https://tailwindcss.com/docs/preflight)。

#### 验证

```bash
npm test
npm run build
```

聊天测试使用模拟响应，不调用真实模型，覆盖空白聊天、首条消息建会话、草稿、上下文隔离、并发流式回复、请求失败和跨分块解析。主题测试覆盖保存与恢复、首次系统偏好、非法存储值、存储不可用和首屏主题初始化。Markdown 测试覆盖回复格式、代码高亮与转义、链接行为、HTML 与危险链接处理，以及逐步追加内容后的解析。剪贴板测试覆盖原文保留、权限失败和接口不可用。

## 部署建议

### 开发环境
- 使用 `npm run dev` 启动服务
- 前端支持热重载

### 生产环境
1. 构建前端生产版本：
```bash
npm run build
```

2. 配置Nginx反向代理：
```nginx
server {
    listen 80;
    server_name example.com;
    
    location / {
        root /path/to/dist;
        index index.html;
        try_files $uri $uri/ /index.html;
    }
    
    location /api/ {
        proxy_pass http://localhost:3000/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

3. 使用PM2管理后端进程：
```bash
cd backend
pm install pm2 -g
pm start
```

## 常见问题

### 1. API请求失败
- 检查 `.env` 文件中的API密钥是否正确
- 确保网络连接正常，能够访问火山方舟，并已开通所配置的模型
- 查看后端日志了解具体错误信息

### 2. 流式响应不显示
- 检查浏览器控制台是否有JavaScript错误
- 确认后端服务正常运行
- 验证网络请求是否成功

### 3. 前端样式异常
- 检查Element Plus是否正确安装
- 清除浏览器缓存
- 查看控制台是否有CSS错误

## 扩展学习

### 功能扩展建议
1. 添加多模型选择功能
2. 实现消息保存和加载
3. 增加用户身份认证
4. 添加语音输入/输出功能
5. 扩展 CSV/JSON 分析和 PDF/Word 文件解析

### 技术深入学习
- Vue 3 Composition API 官方文档
- Node.js 流处理机制
- Server-Sent Events (SSE) 协议
- 火山方舟 Chat API 与 Function Calling 文档

## 贡献指南

欢迎提交Issue和Pull Request来改进这个项目！

## 许可证

MIT License

## 联系方式

如有问题或建议，请通过以下方式联系：
- GitHub Issues: <repository-issues-url>
- 电子邮件: <your-email>

---

**享受AI聊天的乐趣！** 🤖💬
