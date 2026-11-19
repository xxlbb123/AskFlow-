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

前后端均在本机打开。每次可以选择最多 31 个日历日，带日期无时刻时包含该日 00:00 到 23:59。历史工具通过桌面微信界面回溯。[社区历史工具的实现](https://github.com/RungePei/wechat-mcp/blob/main/src/wechat_mcp/wechat_client.py)

## 把语音意见合进清单

社区工具返回消息文字、时间和类型。它有时只能返回「语音 12 秒」之类的提示，接口没有原始音频字段。AskFlow 会直接纳入返回结果里已有的转写。只有语音提示的记录会在清单中列出发送时间和数量。可以在微信对相应消息使用「转文字」，再将得到的内容补到整理请求里。

打开「微信整理」下的「补充微信转写」，粘贴或校对转写文字，为每段填写原始发送时间和发言人。时间范围同时约束微信文字、已有语音转写和补充转写。清单保留引文中的英文术语、缩写、数值和「听不清」标记，并将含糊的意见列入「待确认」。

后续如有可用的原始录音，可以用支持音频输入的方舟模型重转，或接字幕用的专门语音识别服务。论文里的缩写和术语可以配置为热词；仍有疑问的片段可按时间回听。[方舟音频理解](https://docs.volcengine.com/docs/ark/audio-understanding?lang=zh) · [豆包录音文件识别](https://docs.volcengine.com/docs/doubao-voice/recording-file-recognition-lite-http?lang=zh)

## 前端与后端

- Vue 3 和 Element Plus 提供「微信整理」对话框。用户可以补充已转写的语音文字，随整理请求发送原始时间和发言人，随后下载 `.docx` 或 `.md`。
- Express 将明确的请求交给方舟进行 Function Calling，得到联系人、起止分钟和格式。缺少参数时提示补充。然后用进程内 MCP 调用自研 `exportWechatRevisionChecklist`。
- 自研工具作为 MCP Client 启动独立的社区 Server，通过 stdio 调用 `wechat_get_chat_history`。后端按天顺序读取，精确过滤到分钟，逐批提取和合并，再校验引用是否能在原文找到。返回的微信历史数据用于本次整理。
- Word 由 `docx` 库生成。Word 和 Markdown 的引用均保留发送时间、来源及选中记录的条次。实际覆盖受本机微信历史、社区工具的回溯上限和超时影响。

其他 MCP 宿主也可使用自研 Server 的同一个导出工具。它接受 `contact`、`from`、`to`、`format` 和可选的 `voiceTranscripts`，并返回嵌入的文件资源。社区 Server 负责注册微信读取工具。AskFlow 对该 Server 只调用读历史操作。[MCP 架构](https://modelcontextprotocol.io/docs/learn/architecture)

## 验证

```powershell
node --test backend/tests/wechat-export.test.js
npm run build
```

测试通过真实 stdio 连接访问模拟外部 Server，使用合成消息和模拟方舟输出覆盖微信语音转写、手动补充、缺少转写提示、中英混合的待确认项、时间边界、证据归并与两种下载格式。
