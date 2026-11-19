const path = require('node:path');
const { Client } = require('@modelcontextprotocol/client');
const { StdioClientTransport } = require('@modelcontextprotocol/client/stdio');
const { z } = require('zod');
const { HttpError } = require('../utils/http-error');

const HISTORY_TOOL = 'wechat_get_chat_history';
const VOICE_HISTORY_TOOL = 'wechat_get_chat_history_with_voice';
const historySchema = z.object({
  status: z.literal('success'),
  to_user: z.string(),
  target_date: z.string(),
  records: z.array(z.record(z.string(), z.unknown())),
  note: z.string().optional()
});

function historyPayload(result, contact, day) {
  if (result.isError) {
    throw new HttpError(502, '微信 MCP 读取失败，请检查微信登录状态和联系人备注', 'WECHAT_HISTORY_FAILED');
  }
  let payload = result.structuredContent;
  if (payload?.status === undefined) {
    const serialized = payload?.result ?? result.content?.find(part => part.type === 'text')?.text;
    try {
      payload = JSON.parse(serialized);
    } catch {
      throw new HttpError(502, '微信 MCP 返回了无法读取的记录', 'INVALID_WECHAT_TOOL_RESULT');
    }
  }
  if (payload?.status === 'error') {
    if (payload.error_type === 'NotFoundError') {
      throw new HttpError(502, '桌面微信没有提供可读取的聊天界面。请打开已登录的微信主窗口后重试。', 'WECHAT_UI_UNAVAILABLE');
    }
    if (payload.error_type === 'NotLoginError') {
      throw new HttpError(503, '请先登录桌面微信后重试。', 'WECHAT_LOGIN_REQUIRED');
    }
    throw new HttpError(502, '微信 MCP 读取失败，请检查微信登录状态和联系人备注', 'WECHAT_HISTORY_FAILED');
  }
  const parsed = historySchema.safeParse(payload);
  if (!parsed.success || parsed.data.to_user !== contact || parsed.data.target_date !== day) {
    throw new HttpError(502, '微信 MCP 返回的联系人或日期与请求不一致', 'INVALID_WECHAT_TOOL_RESULT');
  }
  return parsed.data;
}

let readingHistory = false;

async function readWechatHistory({ config, contact, days, from, to, signal }) {
  if (!config.wechatMcp) throw new HttpError(503, '请先配置本机微信 MCP', 'WECHAT_MCP_REQUIRED');
  if (readingHistory) throw new HttpError(409, '正在读取另一份微信记录，请稍后重试', 'WECHAT_MCP_BUSY');
  const { command, args } = config.wechatMcp;
  const standardWindows = process.platform === 'win32' && args.length === 2 && args[0] === '-m' && args[1] === 'wechat_mcp';
  const launchArgs = standardWindows ? [path.resolve(__dirname, '../../mcp/wechat_history.py')] : args;
  const client = new Client({ name: 'askflow-wechat-reader', version: '1.0.0' });
  const transport = new StdioClientTransport({
    command, args: launchArgs, stderr: 'pipe', env: { PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' }
  });
  transport.stderr?.resume();
  const options = { signal, timeout: config.requestTimeoutMs };
  readingHistory = true;
  try {
    signal?.throwIfAborted();
    await client.connect(transport, options);
    const { tools } = await client.listTools({}, options);
    const hasVoiceTool = tools.some(tool => tool.name === VOICE_HISTORY_TOOL);
    const hasHistoryTool = tools.some(tool => tool.name === HISTORY_TOOL);
    if (!hasVoiceTool && !hasHistoryTool) {
      throw new HttpError(502, '外部 MCP 未提供微信聊天记录工具', 'WECHAT_TOOL_UNAVAILABLE');
    }
    const history = [];
    // 微信窗口一次只能读取一个会话页面，日期请求在同一连接中串行执行。
    for (const day of days) {
      signal?.throwIfAborted();
      const baseArgs = { to_user: contact, target_date: day };
      let result = hasVoiceTool && await client.callTool({
        name: VOICE_HISTORY_TOOL, arguments: {
          ...baseArgs, from_minute: from.startsWith(day) ? from : `${day}T00:00`, to_minute: to.startsWith(day) ? to : `${day}T23:59`
        }
      }, options);
      if (hasHistoryTool && (!result || result.isError)) {
        result = await client.callTool({ name: HISTORY_TOOL, arguments: { ...baseArgs, save_json: false } }, options);
      }
      history.push(historyPayload(result, contact, day));
    }
    return history;
  } catch (cause) {
    signal?.throwIfAborted();
    if (cause instanceof HttpError) throw cause;
    throw new HttpError(502, '无法连接微信 MCP，请检查 Python 路径、插件和微信登录状态', 'WECHAT_MCP_CONNECTION_FAILED');
  } finally {
    try {
      await client.close();
    } finally {
      readingHistory = false;
    }
  }
}

module.exports = { readWechatHistory };
