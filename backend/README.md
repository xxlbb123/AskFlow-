# AI Chat 后端

使用 Node.js 22+、Express 5 和火山方舟 Chat API、向量 API。支持普通聊天和 TXT/MD 文件的向量检索问答，最终回答均以 SSE 流式输出。

## 启动

在 `backend/` 下安装依赖，将 `.env.example` 复制为 `.env`，填写自己的 `ARK_API_KEY` 和 `ARK_MODEL_ID`。文件问答另需开通向量模型，默认使用 `doubao-embedding-vision-251215`，沿用同一 API Key 和方舟地址。

```bash
npm install
npm run dev
```

`npm run dev` 使用 Node.js 的 watch 模式，修改代码后会自动重启。正常启动使用 `npm start`。

同一端口只启动一份后端。需要手动重启时，在原来运行后端的终端按 Ctrl+C，再运行 `npm run dev`；另开终端运行同一命令会启动第二个进程，不会替换原来的服务。若提示端口被占用，先停止原来的后端。watch 模式下的 “Waiting for file changes before restarting” 表示本次启动失败，文件变化后才会再次尝试。

环境变量总是从 `backend/.env` 加载，因此也可以在项目根目录执行 `node backend/index.js`。

## 代码结构

```text
backend/
├─ index.js                      # 配置加载、监听端口
├─ src/
│  ├─ app.js                     # 创建 Express 应用、注册中间件和路由
│  ├─ config/env.js              # 环境变量读取与校验
│  ├─ routes/chat.routes.js      # URL、HTTP 方法与控制器的对应关系
│  ├─ routes/file.routes.js      # 文件上传与元数据查询
│  ├─ controllers/chat.controller.js  # 参数校验、SSE 输出、超时和取消
│  ├─ services/chat.service.js   # 工具决策、执行、回填与最终回答
│  ├─ services/document.service.js # 保存、列举、读取和检索文档，检查会话范围
│  ├─ documents/parse.js        # 上传文件检查与 UTF-8 解码
│  ├─ documents/chunk.js        # 固定窗口、重叠切分与原文行号
│  ├─ documents/retrieve.js     # 余弦相似度排序、多问题预算与去重
│  ├─ documents/evidence.js     # 本次问答的来源合并、引用编号和总预算
│  ├─ tools/model.tools.js      # 模型工具格式适配、调用格式与 ID 校验
│  ├─ mcp/document.server.js    # 直接注册四个文档工具，定义参数规则和处理函数
│  ├─ mcp/document.client.js    # 创建并连接 SDK 的 Client 和 Server
│  ├─ clients/ark.client.js      # 与方舟通信，支持 JSON 与 SSE 响应
│  ├─ clients/embedding.client.js # 豆包向量请求、语料与查询指令、响应校验
│  ├─ middleware/error-handler.js     # 统一 JSON/SSE 错误处理
│  └─ utils/http-error.js        # 携带 HTTP 状态码的业务错误
└─ tests/                       # 普通聊天和文件问答的接口测试
```

请求经过 `路由 → 控制器 → 业务服务 → 方舟客户端`。

- 路由声明接口地址，控制器处理 HTTP 输入和输出。
- 服务组织业务流程，不依赖 Express 的 `req`、`res`。
- 客户端处理方舟请求和响应，不负责文件检索或会话业务。
- 创建应用与启动监听分开，测试可以使用临时端口和模拟的上游。

## 配置

| 环境变量 | 默认值 / 用途 |
| --- | --- |
| `PORT` | `3000` |
| `ARK_API_KEY` | 必填，方舟 API Key |
| `ARK_MODEL_ID` | 必填，方舟模型 ID |
| `ARK_EMBEDDING_MODEL_ID` | `doubao-embedding-vision-251215`，文档和问题使用的向量模型，也支持配置该模型的 Endpoint ID |
| `ARK_EMBEDDING_DIMENSIONS` | `1024`，向量维度，仅支持 `1024` 或 `2048` |
| `ARK_BASE_URL` | `https://ark.cn-beijing.volces.com/api/v3` |
| `ARK_REQUEST_TIMEOUT_MS` | `120000`，单次聊天总期限及单次向量 HTTP 请求期限，覆盖连接与响应读取 |
| `ARK_MAX_TOKENS` | `4000`，回复 token 上限，不是输入预算 |
| `JSON_BODY_LIMIT` | `1mb`，聊天 JSON 请求体上限 |
| `CORS_ORIGIN` | `*`，也支持逗号分隔的前端地址 |
| `DOCUMENT_STORAGE_DIR` | `storage/documents`，相对 backend，也支持绝对路径 |
| `FILE_MAX_BYTES` | `2097152`，后端单个文件上限；当前前端固定限制 2 MB |
| `FILE_PROCESSING_TIMEOUT_MS` | `300000`，文件操作及 MCP 调用总期限，涵盖上传分块的向量生成；前端上传固定等待 5 分钟 |
| `DOCUMENT_CONTEXT_BUDGET` | `12000`，一次提问所有子问题及补查共享的资料预算，包含来源元数据 |
| `DOCUMENT_MAX_SEARCH_ROUNDS` | `3`，非流式工具决策的循环上限，可配置 1–5 |
| `CHAT_INPUT_BUDGET` | `48000`，模型输入 JSON 的大小预算；超出时提示新建会话 |

`.env` 和 `storage/` 不提交到 Git。输入预算使用 UTF-8 字节数作保守估算，并非模型精确 token 数；不自动丢弃聊天历史。请求层不输出 Authorization 请求头或完整聊天内容。

## 接口

### GET /health

```json
{ "status": "ok", "message": "AI Chat API is running" }
```

这个接口检查 HTTP 服务是否运行，不会请求模型。

### POST /api/chat

使用 `Content-Type: application/json`，提交非空的 `messages` 数组，消息包含 `role` 和字符串 `content`。当前接受 `system`、`user`、`assistant`，至少包含一条非空的用户消息。

```json
{
  "messages": [
    { "role": "user", "content": "你好" }
  ]
}
```

成功时返回 `text/event-stream`，兼容现有前端的 `choices[0].delta.content` 解析方式：

```text
data: {"choices":[{"delta":{"content":"你好！"}}]}

data: [DONE]
```

带附件的请求额外传入 `fileIds: [fileId]` 和 `scopeId`。目前每个会话支持一个文件；连续提问沿用相同的文件 ID 和范围标识，不重新发送全文。

文件问答先创建绑定本会话文件的 MCP 客户端和服务端，通过官方 SDK 的进程内传输进行真实的 `tools/list` 和 `tools/call`。工具定义从 MCP 发现结果转换为模型的 Function Calling 格式；检索由 MCP 服务执行。

`document.client.js` 只负责建立连接，返回 SDK 的 `client` 和 `server`。聊天服务直接调用 `client.listTools()`、`client.callTool({ name, arguments }, { signal, timeout })`，并在 `finally` 中关闭两端；文件接口也直接使用 SDK 调用工具。参数由 MCP Server 的 schema 校验，结果直接从 `structuredContent` 读取，不再另包一层工具调用接口。

后端先通过 `listDocuments` 检查附件并取得元数据，将文件信息直接提供给模型。非流式 `createCompletion()` 选择工具，多个问题优先组成 `searchDocuments({ fileId, queries })` 的查询数组，每批最多 8 个查询；需要指定位置原文时调用 `readDocument`。模型只获得搜索和读取两个工具，无需再次查询文件列表。每个工具调用按名称单独执行，其结果只回填到对应的 `tool_call_id`。若模型没有查阅原文，程序使用最新问题通过 MCP 检索一次。

检索使用有限的非流式循环：模型提出查询 → MCP 检索 → 按调用 ID 回填结果 → 模型判断是否还需补查。每次工具决策都返回完整 JSON，不在 SSE 中拼接工具参数。思考模型的 `reasoning_content` 在工具回填时保留；模型不再提出工具调用时结束检索。

默认最多 3 轮工具决策，每轮最多 8 个工具调用。模型不再提出工具调用、附件全文已提供或工具历史过大时，也结束工具决策。每次提出的调用直接通过 MCP 执行，重复查询也受轮数上限约束，不额外维护工具调用缓存。当前单附件的全文状态用一个布尔值记录。来源以文件 ID 和分块 ID 去重，引用编号在本次问答中统一分配并保持稳定，所有搜索和读取结果共享资料总预算。随后单独发送携带原问题、文件元数据和已有资料的流式回答请求，不提供工具；没有依据的部分要求模型明确说明。首次检索实际提供全部分块时，通常是一次工具决策加一次回答；检索片段已足够时，通常是规划、确认资料足够、流式回答共 3 次聊天模型请求，补查可能增加请求次数，默认最多 4 次。向量请求另按每次搜索的去重查询数计算。无效工具、重复调用 ID、越界文件和无效参数仍会被拒绝。

所有检索在最终流之前完成；流开始时发送累积来源和生成状态两种应用事件。普通聊天仍保持原来的协议：

```text
data: {"type":"sources","mode":"retrieval","sources":[{"index":1,"fileId":"…","chunkId":"chunk-3","name":"规则.md","section":"会话保存","startLine":12,"endLine":16,"text":"原文…"}]}

data: {"type":"status","message":"正在生成回复…"}
```

来源来自后端真实检索结果；模型被要求使用 `[1]` 等标记引用。正文中与本条消息来源匹配的编号显示为小号引用按钮，兼容旧的 `[index 1]` 写法；点击后展开对应原文。代码中的标记和不存在的来源编号保持原文，普通 Markdown 链接仍可正常访问。页面展示的是本次提供给模型的参考资料，不代表模型一定使用了每一处，也不验证回答与原文的语义对应关系。

在发送 SSE 响应头前出现的错误使用 HTTP 状态码和 JSON 返回：

```json
{ "error": { "code": "INVALID_MESSAGES", "message": "messages 必须是非空数组" } }
```

已经开始流式回复后出现的错误，以相同错误对象作为 `data:` 事件发送，再发送 `[DONE]`。客户端断开连接会取消上游请求。

收到 HTTP 200、状态/来源事件或 `[DONE]` 不代表有回复正文。方舟客户端按完整 SSE 行检查正文、`finish_reason` 和结束标记：只有思考内容或空白时返回 `EMPTY_AI_REPLY`，长度截断返回 `AI_OUTPUT_TRUNCATED`，连接提前关闭返回 `UPSTREAM_INCOMPLETE_RESPONSE`。回答阶段不提供工具，若上游仍返回工具调用则明确报 `AI_UNEXPECTED_TOOL_CALL`，不再混同空回答。错误事件会在 `[DONE]` 前发出；部分正文仍保留。工具决策阶段被长度上限截断时返回 `AI_TOOL_DECISION_TRUNCATED`。

前端也检查这些情况，并在没有收到正文时展示“重试回复”。重试复用已有用户消息、聊天历史和附件，不重复插入问题。后台的异常日志仅包含结束原因和字符计数，不记录聊天、原文或思考内容。

### POST /api/files?name=文件名&scopeId=UUID

使用 `Content-Type: application/octet-stream`，请求体直接传原文件字节。选择二进制上传是因为第一版每次只有一个文件，不需要 multipart 依赖。查询参数需要使用 URLSearchParams 编码。

支持 UTF-8 编码（含 BOM）的 `.txt`、`.md`，默认最大 2 MB。不支持空白文件、二进制内容和其他编码；GBK 等编码需要先转换为 UTF-8。

上传接口直接调用 MCP 的 `ingestDocuments`，原文件字节在内部 MCP 消息中用 Base64 表示，以保留 BOM、换行和原始字节。文档服务检查并解码文本、切分，再每批最多 4 个分块并行调用向量模型。全部向量成功生成后保存文件并返回“已就绪”；中途失败不会保存半份文档。上传不调用聊天模型，也不创建聊天会话，但会消耗向量模型的请求额度。后端文件操作与 MCP 总期限默认 5 分钟，前端上传也等待 5 分钟，单次向量 HTTP 请求仍受 `ARK_REQUEST_TIMEOUT_MS` 限制；超时或客户端断开时取消处理。成功返回 HTTP 201：

```json
{"file":{"id":"服务端生成的 UUID","name":"规则.md","type":"md","size":1200,"status":"ready","chunkCount":4,"createdAt":"…"}}
```

### GET /api/files/:id?scopeId=UUID

通过 MCP 的 `listDocuments` 查询指定附件元数据，不返回全文或整个分块数组。不存在的附件或其他范围的附件返回 404。

`scopeId` 是前端为草稿生成并迁移到会话的随机标识，属于本地版本的附件访问凭据，并不是用户身份认证。当前接口面向本地开发；登录和多用户授权尚未接入。

## 文件保存与检索

```text
storage/documents/<fileId>/
├─ original.txt 或 original.md   # 原始字节
└─ document.json                # 文件元数据、scopeId、切分配置、向量配置、chunks
```

每个 chunk 保存 `id`、`section`、`startLine`、`endLine`、`content` 和 `embedding` 向量。参考 yuan-agent 的固定窗口方案，每块最多 900 个 Unicode 字符，相邻窗口重叠 160 字符（步长 740），保留跨块上下文并避免切坏 emoji；最后一个窗口已覆盖文件尾部时停止。窗口两端空白会裁掉，行号按实际保留文字的位置计算。`section` 表示窗口起始位置的 Markdown ATX 标题路径，代码围栏内的标题不当作章节标题；窗口可能跨章节或代码围栏，并不保证保留完整语法结构。

上传向量输入为每块的 `section + 换行 + content`，使用 Corpus 指令；问题向量使用 Query 指令。新文档保存 version=3，并记录 `embedding: { model, dimensions, profile }`，其中当前 profile 为 `doubao-text-retrieval-v1`。文档与问题必须使用同一模型、维度和检索指令版本。向量仅保留在后端 JSON 中，MCP 工具、聊天模型和前端收到的是原文与来源信息。

一次搜索先对查询数组去重，再为每个查询生成向量；计算其与所有文档分块向量的余弦相似度，保留分数大于 0 的前 4 个分块。各子问题轮流选一块，重复原文共享编号，并受资料预算约束；不再按关键词排序或自动补相邻块，需要上下文时由 `readDocument` 补读。只有实际选中所有分块时返回 `mode: full`，否则为 `retrieval`；短文件也不会仅因预算足够就直接提供全文。

本次检索独立返回结果和局部来源编号，不保存此前查询或累计来源；聊天流程负责跨工具合并、重编号和总预算。查询结果标识 `matched`、`no_match` 或 `budget_limited`。正相似分数只用于基础筛选，不保证片段足够回答；实际召回效果与阈值仍需用真实文档和问题验证。目前没有接入向量数据库、重排模型或混合检索。

旧的 version=1/2 文档仍可读取元数据和原文分块，但搜索时缺少兼容向量会返回 HTTP 409、`DOCUMENT_REINDEX_REQUIRED`。更换模型、维度或 profile 时也返回同一错误，不自动重建索引。请新建聊天并重新上传文件，当前会话不能替换已发送的附件。

## MCP 文档工具

四个工具使用同一份文档服务，不在工具回调中重复实现文件处理：

| 工具 | 参数 | 用途 |
| --- | --- | --- |
| `ingestDocuments` | `documents: [{ name, dataBase64 }]`，当前每次一份 | 程序上传、切分、建立向量索引和保存 |
| `listDocuments` | `{}` | 当前授权范围的文件元数据 |
| `searchDocuments` | `fileId, queries` | 按每个问题的向量相似度批量检索原文 |
| `readDocument` | `fileId, startChunk=1, count=1`，count 最大 6 | 指定范围原文；必要时返回 nextChunk |

每个工具直接使用 SDK 的 `server.registerTool(名称, 定义, 处理函数)` 注册。`inputSchema` 是参数规则：例如文件 ID 必须在允许范围内，queries 必须包含 1–8 个非空问题；MCP Server 在执行工具前按这些规则校验参数。为便于阅读，暂不声明可选的 `outputSchema`，SDK 不再额外校验业务返回字段的结构。成功结果仍同时包含 `structuredContent` 与序列化 JSON 的文本 `content`，业务错误使用 `isError: true`；HTTP 接口将工具业务错误转换为 HTTP 响应，聊天则可以将工具错误回填给模型。各工具保留行为 annotations，说明是否只读等属性。

聊天模型只获得 `searchDocuments`、`readDocument`；`listDocuments` 由程序在聊天开始时调用，入库工具由上传接口直接调用。MCP 服务仍注册四个工具，供程序和外部客户端使用。工具参数不包含 scopeId 或任意文件路径，授权范围由后端创建连接时绑定。每次调用使用自己的取消信号；MCP 服务不保存聊天查询、来源或引用编号。

## 外部 MCP 客户端

聊天应用自动使用进程内 MCP，无需另开终端、端口或修改原有 `.env`。如果其他 MCP 客户端需要复用检索，可使用独立 stdio 入口：

```bash
node backend/mcp.js --scope-id <会话UUID> [--file-id <附件UUID>]
```

也可在 `backend/` 下运行 `npm run mcp -- --scope-id <会话UUID> --file-id <附件UUID>`。标识来自聊天请求的 `scopeId` 和上传接口的 `file.id`；指定 fileId 时启动前检查文件所属范围，列表、搜索和读取限制在该附件内。不指定 fileId 时可导入、列举和使用当前 scopeId 的文档。MCP 客户端应启动该进程，通过 stdin/stdout 交换 JSON-RPC，stdout 不输出普通日志，不接受任意路径或其他会话标识。应用内连接在本次操作结束、失败或取消后释放，来源累积和工具轮次由聊天服务管理。

原文件和 JSON 可跨后端重启保留。前端会话、消息、引用及附件关联通过 Pinia 持久化插件保存在浏览器 `localStorage`，刷新后可恢复已有会话并沿用附件追问。移除待发送附件或删除本地会话会解除前端关联，已经保存的文件不会立刻从磁盘删除；自动清理和文件管理后续实现。

## 验证

```bash
npm test
```

测试使用模拟的方舟响应和本地临时端口，不调用真实模型，不消耗 API 额度。覆盖流式转发、参数校验、跨域、上游错误、超时和客户端断开。

文件测试另外覆盖落盘后重新读取、UTF-8/大小校验、批量查询的共享预算、来源去重及编号、真实 MCP 发现/调用、非流式工具循环、检索轮次上限和取消。向量客户端使用模拟 HTTP 响应验证 Query/Corpus 指令、单条输入协议、配置、无效向量、取消和超时；文件及检索测试使用固定假向量验证排序、去重、索引兼容与上传失败处理。`mcp-stdio.test.js` 通过独立 Node 子进程验证外部 MCP 客户端；与启动测试一样需要允许进程派生。前端根目录的测试包含真实本地 HTTP 链路验证和 Vue 组件渲染验证。测试不会验证真实模型的权限、连通性或召回效果，需使用已开通模型另行实际验证。

## 下一阶段

逐步加入长文分层总结、CSV/JSON 分析、DOCX/PDF 解析和索引重建管理。当前解析器仅支持 UTF-8 TXT/MD；虽然所选向量模型具有多模态能力，应用仍只发送文本输入，尚未实现图片、视频或 PDF 的读取和检索。

工具发现、输入输出 schema 和结果格式参考 [MCP 工具规范](https://modelcontextprotocol.io/specification/2025-06-18/server/tools)。

工具协议参考[火山方舟 Chat API](https://docs.volcengine.com/docs/ark/chat-api?lang=zh&redirect=1)，二进制请求体使用 [Express raw 中间件](https://expressjs.com/en/resources/middleware/body-parser/#bodyparserrawoptions)。

向量请求使用 `/embeddings/multimodal`、单条文本输入和 `data.embedding` 返回值，Query 与 Corpus 分别使用业务检索指令和压缩语料指令，参考[多模态向量化 API](https://docs.volcengine.com/docs/ark/multimodal-vectorization-api?lang=zh)及[向量化指令说明](https://docs.volcengine.com/docs/ark/vectorization?lang=zh)。
