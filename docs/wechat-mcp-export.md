# 微信论文反馈读取、校对和导出

在 AskFlow 的普通聊天框发送微信备注和时段。助手会显示读取进度，随后把找到的文字和能取得的语音转写列在对话中，供逐条校对。姓名和发送时间随每条记录显示。

> 整理我跟王老师 2026 年 11 月 3 日到 11 月 6 日的微信记录，提取他对我论文的修改意见，按摘要、方法、实验和图表分条整理成 Word。

联系人或时间缺失时，直接回复助手的追问即可继续。校对完成后，在原来的聊天框回复「确认整理」。清空的一条会略过。默认导出 Word，需要 Markdown 时可以在初次请求或确认时指定。下载链接出现在整理结果下方。

## 本机配置

1. 按社区项目文档安装 `wechat-mcp`，启动并登录受支持的 Windows 微信桌面版。保持窗口可操作。[社区 wechat-mcp](https://github.com/RungePei/wechat-mcp)
2. 在 `backend/.env` 中填写安装该模块的 Python 路径，并重启后端。可以使用正常聊天的方舟模型配置。

```dotenv
WECHAT_MCP_COMMAND=C:/path/to/wechat-mcp/.venv/Scripts/python.exe
WECHAT_MCP_ARGS=["-m","wechat_mcp"]
```

前后端均在本机打开。每次可以选择最多 31 个日历日，带日期无时刻时包含该日 00:00 到 23:59。历史工具通过桌面微信界面回溯。[社区历史工具的实现](https://github.com/RungePei/wechat-mcp/blob/main/src/wechat_mcp/wechat_client.py)

Windows 微信在客户端内部保存本机消息。AskFlow 接入的 `wechat-mcp` 通过 Windows UI Automation 操作已登录的桌面微信，定位会话、回溯记录并读取界面中呈现的消息。历史覆盖取决于电脑微信可查看的记录。微信的本地存储格式由客户端管理，官方备份用于恢复或迁移。[Windows 微信消息数据库架构](https://developer.cloud.tencent.com/article/2088835) · [腾讯关于微信记录存储和备份的说明](https://static.www.tencent.com/uploads/2023/04/06/4d0834be27f876732f34898c44b1d714.pdf) · [社区工具实现](https://github.com/RungePei/wechat-mcp)

读取历史和调用微信自带转写时，桌面微信需要已登录且界面可操作。聊天中出现待校对记录后，即可在微信退出的情况下继续校对和生成文档；生成时仍需要连通项目配置的模型服务。

MCP 是 AskFlow 调用历史工具的接口。从命令行直接调用同一读取库也依赖桌面微信的界面。微信官方 iLink 提供机器人会话的消息收发，其公开协议未提供按联系人和时间查询既有个人聊天的接口。[微信官方渠道协议](https://github.com/Tencent/openclaw-weixin/blob/main/docs/protocol_zh_CN.md)

## 把语音意见合进清单

默认 Windows 配置会启动 AskFlow 的微信 MCP 适配器。它复用社区工具回溯记录，对时段内仍缺转写的语音尝试调用桌面微信的「语音转文字」菜单。微信返回的已有转写也会进入校对。界面无法提供转写的语音保留原发送时间，显示为「待转写语音」。

需要补充转写时，直接在待核对记录的相应行输入或粘贴文字。文档会保留原时间、来源和校对标记。英文术语、缩写、数值和「听不清」保留在引文中，含糊的意见列入「待确认」。

后续如有可用的原始录音，可以用支持音频输入的方舟模型重转，或接字幕用的专门语音识别服务。论文里的缩写和术语可以配置为热词；仍有疑问的片段可按时间回听。[方舟音频理解](https://docs.volcengine.com/docs/ark/audio-understanding?lang=zh) · [豆包录音文件识别](https://docs.volcengine.com/docs/doubao-voice/recording-file-recognition-lite-http?lang=zh)

## 前端与后端

- 前端通过 `POST /api/chat` 接收进度、待校对记录和下载事件。后端为每个会话保留一批待校对记录，最长两小时。页面刷新可以重新取回原记录，尚未提交的编辑保存在当前页面。
- 方舟通过 Function Calling 解析联系人、起止分钟和格式，或请求补充。后端按天通过 MCP 读取并处理语音，按分钟筛选后展示给用户。主聊天收到明确确认后，才把校对后的正文交给模型提取、归并和核对引文。
- Windows 适配入口在 `backend/mcp/wechat_history.py`。支持扩展的 MCP 通过 `wechat_get_chat_history_with_voice` 提供转写；基础 Server 使用 `wechat_get_chat_history` 读取。后端保留未得到转写的语音供校对。
- Word 由 `docx` 库生成。聊天生成的文件默认保存在本机 `backend/storage/documents/wechat-reports`，浏览器重开同一会话后仍可下载。Word 和 Markdown 的引用保留发送时间、来源及条次。实际覆盖受本机微信历史、社区工具的回溯上限和超时影响。

其他 MCP 宿主也可使用自研 Server 的同一个导出工具。它接受 `contact`、`from`、`to`、`format` 和可选的 `voiceTranscripts`，并返回嵌入的文件资源。社区 Server 负责注册微信读取工具。AskFlow 对该 Server 只调用读历史操作。[MCP 架构](https://modelcontextprotocol.io/docs/learn/architecture)

## 验证

```powershell
node --test backend/tests/wechat-chat.test.js
npm run build
```

测试通过真实 stdio 连接模拟微信 Server，使用合成文字、已转写语音和待转写语音验证校对、确认和导出。本机微信主窗口无法识别时，详见[真实环境的排查与验收记录](requirements-and-progress.md)。
