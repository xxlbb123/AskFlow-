const assert = require('node:assert/strict');
const { McpServer } = require('@modelcontextprotocol/server');
const { StdioServerTransport } = require('@modelcontextprotocol/server/stdio');
const { z } = require('zod');

const daily = {
  '2026-11-03': [
    ['09:00', '范围之前的意见'],
    ['10:00', '表 2 要补充标准差。'],
    ['11:20', '方法部分说明随机种子。'],
    ['11:40', '语音8"秒消息内容:表 2 记得给出标准差。', '语音'],
    ['11:50', '語音5"秒 把 baseline 改成【听不清】，保留 F1-score。', '语音']
  ],
  '2026-11-04': [
    ['09:30', '表 2 把标准差加进去。'],
    ['10:00', '[语音] 12秒'],
    ['16:00', '范围之后的意见'],
    ['16:15', '语音7"秒范围之外的微信语音。', '语音']
  ]
};
const fixture = new McpServer({ name: 'wechat-mcp-test-fixture', version: '1.0.0' });
fixture.registerTool('wechat_get_chat_history', {
  inputSchema: z.object({ to_user: z.string(), target_date: z.string(), save_json: z.boolean() }).strict()
}, async ({ to_user, target_date, save_json }) => {
  assert.equal(to_user, '王老师');
  assert.equal(save_json, false);
  assert.ok(Object.hasOwn(daily, target_date));
  const records = daily[target_date].map(([clock, text, type]) => ({
    '时间ISO': target_date + 'T' + clock + ':00', '发送者': '王老师', '消息': text, ...(type && { '类型': type })
  }));
  return { content: [{ type: 'text', text: JSON.stringify({
    status: 'success', to_user, target_date, records
  }) }] };
});
fixture.connect(new StdioServerTransport()).catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
