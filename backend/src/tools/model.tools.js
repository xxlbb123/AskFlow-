const { HttpError } = require('../utils/http-error');

const toModelTools = tools => tools.map(tool => ({ type: 'function', function: {
  name: tool.name, description: tool.description, parameters: tool.inputSchema
} }));

// 只整理模型调用的公共格式；工具参数由 MCP 发现的 schema 和服务端校验。
function prepareToolCalls(message, tools, usedIds) {
  const raw = message.tool_calls === undefined ? [] : message.tool_calls;
  const names = new Set(tools.map(tool => tool.name));
  if (!Array.isArray(raw) || raw.length > 8) throw new HttpError(502, 'AI 返回的工具调用数量无效', 'INVALID_TOOL_CALL');
  const calls = raw.map(call => {
    let args;
    try { args = JSON.parse(call?.function?.arguments); } catch { /* 下面统一校验。 */ }
    if (!call || typeof call.id !== 'string' || !call.id || call.type !== 'function'
      || !names.has(call.function?.name) || !args || typeof args !== 'object' || Array.isArray(args)) {
      throw new HttpError(502, 'AI 返回了无效的工具调用，请重试', 'INVALID_TOOL_CALL');
    }
    return { id: call.id, name: call.function.name, args };
  });
  if (new Set(calls.map(call => call.id)).size !== calls.length || calls.some(call => usedIds.has(call.id))) {
    throw new HttpError(502, 'AI 返回了重复的工具调用标识，请重试', 'INVALID_TOOL_CALL');
  }
  const assistant = { role: 'assistant', content: typeof message.content === 'string' ? message.content : null,
    tool_calls: raw };
  if (typeof message.reasoning_content === 'string') assistant.reasoning_content = message.reasoning_content;
  return { calls, assistant };
}

module.exports = { toModelTools, prepareToolCalls };
