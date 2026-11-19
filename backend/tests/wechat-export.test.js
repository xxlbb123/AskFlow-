const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const { once } = require('node:events');
const { randomUUID } = require('node:crypto');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createApp } = require('../src/app');
const { createConfig } = require('../src/config/env');

const expected = [
  ['图表', '表 2 要补充标准差。'],
  ['方法', '方法部分说明随机种子。'],
  ['图表', '表 2 把标准差加进去。']
];
const response = message => Response.json({ choices: [{ message }] });

test('one request calls the external WeChat MCP and downloads Word or Markdown', { timeout: 15000 }, async t => {
  const config = createConfig({
    ARK_API_KEY: 'fake', ARK_MODEL_ID: 'fake',
    DOCUMENT_STORAGE_DIR: path.join(os.tmpdir(), randomUUID()),
    DATABASE_PATH: ':memory:',
    WECHAT_MCP_COMMAND: process.execPath,
    WECHAT_MCP_ARGS: JSON.stringify([path.resolve(__dirname, 'helpers/wechat-mcp-fixture.cjs')])
  });
  let planned = 0;
  let extracted = 0;
  const app = createApp({ config, fetchImpl: async (url, request) => {
    assert.ok(url.endsWith('/chat/completions'));
    const payload = JSON.parse(request.body);
    if (payload.tools) {
      planned++;
      const prompt = payload.messages.at(-1).content;
      if (prompt === '缺失联系人和日期') return response({ content: '请补充' });
      const format = prompt.includes('Markdown') ? 'markdown' : 'docx';
      return response({ tool_calls: [{
        id: 'test-plan', type: 'function',
        function: {
          name: 'exportWechatRevisionChecklist',
          arguments: JSON.stringify({ contact: '王老师', from: '2026-11-03T10:00', to: '2026-11-04T10:00', format })
        }
      }] });
    }
    const input = JSON.parse(payload.messages.at(-1).content);
    if (input.chunks) {
      extracted++;
      assert.equal(input.advisor, '王老师');
      assert.doesNotMatch(input.chunks.map(chunk => chunk.text).join('\n'), /范围之前|范围之后|\[语音\]/);
      return response({ content: JSON.stringify({ items: expected.map(([category, quote]) => ({
        action: quote, category,
        evidence: [{ chunkId: input.chunks.find(chunk => chunk.text.includes(quote)).id, quote }]
      })) }) });
    }
    assert.equal(input.items.length, 3);
    return response({ content: JSON.stringify({ groups: [
      { category: '图表', action: '在表 2 报告标准差', itemIds: [1, 3] },
      { category: '方法', action: '写明随机种子', itemIds: [2] }
    ] }) });
  } });

  const server = http.createServer(app).listen(0, '127.0.0.1');
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    app.locals.db?.close();
  });
  await once(server, 'listening');
  const base = 'http://127.0.0.1:' + server.address().port;
  const exportReport = (request, headers = {}) => fetch(base + '/api/wechat/revision-checklist', {
    method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ request })
  });

  const foreign = await exportReport('试图从远程网页读取', { Origin: 'https://example.invalid' });
  assert.equal(foreign.status, 403);
  assert.equal(planned, 0);
  const incomplete = await exportReport('缺失联系人和日期');
  assert.equal(incomplete.status, 400);
  assert.equal((await incomplete.json()).error.code, 'WECHAT_REQUEST_INCOMPLETE');

  const sentence = '整理和王老师 2026 年 11 月 3 日 10 点到 11 月 4 日 10 点的论文意见';
  const docx = await exportReport(sentence + '，输出 Word');
  assert.equal(docx.status, 200);
  assert.match(docx.headers.get('content-type'), /wordprocessingml\.document/);
  assert.match(docx.headers.get('content-disposition'), /wechat-revision\.docx/);
  const word = Buffer.from(await docx.arrayBuffer());
  assert.equal(word.subarray(0, 4).toString('hex'), '504b0304');
  if (process.env.WECHAT_TEST_WORD_OUTPUT) await fs.writeFile(process.env.WECHAT_TEST_WORD_OUTPUT, word);

  const markdown = await exportReport(sentence + '，输出 Markdown');
  assert.equal(markdown.status, 200);
  assert.match(markdown.headers.get('content-type'), /^text\/markdown/);
  const report = await markdown.text();
  assert.match(report, /共处理 3 条/);
  assert.match(report, /缺少有效时间或可用文字/);
  assert.match(report, /归并出 2 项/);
  assert.match(report, /表 2 要补充标准差/);
  assert.match(report, /表 2 把标准差加进去/);
  assert.equal(extracted, 2);
});
