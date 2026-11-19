# 微信论文反馈一键导出

在 AskFlow 输入框旁点击「微信整理」，输入一句带微信备注、开始时间和结束时间的请求。点击「生成并下载」后，应用会读取记录、合并重复意见并下载 Word。可以在同一句话里指定 Markdown。

> 整理我跟王老师 2026 年 11 月 3 日到 11 月 6 日的微信记录，提取他对我论文的修改意见，按摘要、方法、实验和图表分条整理成 Word。

## 本机配置

1. 按社区项目文档安装 `wechat-mcp`，启动并登录受支持的 Windows 微信桌面版。保持窗口可操作。[社区 wechat-mcp](https://github.com/RungePei/wechat-mcp)
2. 在 `backend/.env` 中填写安装该模块的 Python 路径，并重启后端。可以使用正常聊天的方舟模型配置。

```dotenv
WECHAT_MCP_COMMAND=C:/path/to/wechat-mcp/.venv/Scripts/python.exe
WECHAT_MCP_ARGS=["-m","wechat_mcp"]
```

前后端均在本机打开。每次可以选择最多 31 个日历日，带日期无时刻时包含该日 00:00 到 23:59。工具基于微信界面回溯，目前处理返回的文字消息。缺少可用文字的语音占位会在报告里计数。

## 前端与后端

- Vue 3 和 Element Plus 提供「微信整理」对话框。用户发送一段话，前端等待文件响应并下载原生 `.docx` 或 `.md`。
- Express 将明确的请求交给方舟进行 Function Calling，得到联系人、起止分钟和格式。缺少参数时提示补充。然后用进程内 MCP 调用自研 `exportWechatRevisionChecklist`。
- 自研工具作为 MCP Client 启动独立的社区 Server，通过 stdio 调用 `wechat_get_chat_history`。后端按天顺序读取，精确过滤到分钟，逐批提取和合并，再校验引用是否能在原文找到。返回的微信历史数据用于本次整理。
- Word 由 `docx` 库生成。引用保留消息时间和选中记录的条次。实际覆盖受本机微信历史、社区工具的回溯上限和超时影响。

其他 MCP 宿主也可使用自研 Server 的同一个导出工具。它接受 `contact`、`from`、`to` 和 `format`，并返回嵌入的文件资源。社区 Server 负责注册微信读取工具。AskFlow 对该 Server 只调用读历史操作。[MCP 架构](https://modelcontextprotocol.io/docs/learn/architecture)

## 验证

```powershell
node --test backend/tests/wechat-export.test.js
npm run build
```

测试通过真实 stdio 连接访问模拟外部 Server，使用合成消息和模拟方舟输出覆盖时间边界、证据归并与两种下载格式。
