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
  ['方法', '随机种子要写到方法部分。'],
  ['图表', '表 2 记得给出标准差。'],
  ['实验与结果', '把 baseline 改成【听不清】，保留 F1-score。'],
  ['图表', '表 2 把标准差加进去。']
];
const response = message => Response.json({ choices: [{ message }] });

test('WeChat text, available voice transcripts and pasted transcripts are filtered and exported together', { timeout: 15000 }, async t => {
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
      const raw = input.chunks.map(chunk => chunk.text).join('\n');
      assert.match(raw, /2026-11-03 11:40 王老师：【微信语音转写】表 2 记得给出标准差/);
      assert.match(raw, /2026-11-03 11:30 王老师：【补充语音转写】随机种子要写到方法部分/);
      assert.doesNotMatch(raw, /范围之前|范围之后|范围之外|\[语音\]|语音8"秒/);
      return response({ content: JSON.stringify({ items: expected.map(([category, quote]) => ({
        action: quote, category,
        evidence: [{ chunkId: input.chunks.find(chunk => chunk.text.includes(quote)).id, quote }]
      })) }) });
    }
    assert.equal(input.items.length, 6);
    assert.equal(input.items[4].category, '待确认');
    return response({ content: JSON.stringify({ groups: [
      { category: '图表', action: '在表 2 报告标准差', itemIds: [1, 4, 6] },
      { category: '方法', action: '写明随机种子', itemIds: [2, 3] },
      { category: '实验与结果', action: '核对 baseline 的改法', itemIds: [5] }
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
  const exportReport = (request, voiceTranscripts, headers = {}) => fetch(base + '/api/wechat/revision-checklist', {
    method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ request, voiceTranscripts })
  });

  const foreign = await exportReport('试图从远程网页读取', undefined, { Origin: 'https://example.invalid' });
  assert.equal(foreign.status, 403);
  assert.equal(planned, 0);
  const incomplete = await exportReport('缺失联系人和日期');
  assert.equal(incomplete.status, 400);
  assert.equal((await incomplete.json()).error.code, 'WECHAT_REQUEST_INCOMPLETE');

  const sentence = '整理和王老师 2026 年 11 月 3 日 10 点到 11 月 4 日 10 点的论文意见';
  const voiceTranscripts = [
    { time: '2026-11-03T11:30', speaker: '王老师', text: expected[2][1] },
    { time: '2026-11-04T10:01', speaker: '王老师', text: '范围之外的转写' }
  ];
  const invalidVoice = await exportReport(sentence, [{ ...voiceTranscripts[0], time: '2026-11-31T11:30' }]);
  assert.equal(invalidVoice.status, 400);
  assert.equal((await invalidVoice.json()).error.code, 'INVALID_VOICE_TRANSCRIPT');

  const docx = await exportReport(sentence + '，输出 Word', voiceTranscripts);
  assert.equal(docx.status, 200);
  assert.match(docx.headers.get('content-type'), /wordprocessingml\.document/);
  assert.match(docx.headers.get('content-disposition'), /wechat-revision\.docx/);
  const word = Buffer.from(await docx.arrayBuffer());
  assert.equal(word.subarray(0, 4).toString('hex'), '504b0304');
  if (process.env.WECHAT_TEST_WORD_OUTPUT) await fs.writeFile(process.env.WECHAT_TEST_WORD_OUTPUT, word);

  const markdown = await exportReport(sentence + '，输出 Markdown', voiceTranscripts);
  assert.equal(markdown.status, 200);
  assert.match(markdown.headers.get('content-type'), /^text\/markdown/);
  const report = await markdown.text();
  assert.match(report, /共处理 3 条微信文字、2 条微信语音转写和 1 段补充语音转写/);
  assert.match(report, /微信返回的 1 条语音缺少转写文字，请按发送时间 2026-11-04 10:00/);
  assert.match(report, /有 1 段补充语音的发送时间在所选范围之外/);
  assert.match(report, /归并出 3 项/);
  assert.match(report, /表 2 要补充标准差/);
  assert.match(report, /表 2 把标准差加进去/);
  assert.match(report, /2026-11-03 11:40 · 微信语音转写 · 第 4 条 “表 2 记得给出标准差。/);
  assert.match(report, /2026-11-03 11:30 · 补充语音转写 · 第 3 条 “随机种子要写到方法部分。/);
  assert.match(report, /## 3\. 待确认\n\n- \[ \] 核对 baseline 的改法/);
  assert.match(report, /把 baseline 改成【听不清】，保留 F1-score。/);
  assert.equal(extracted, 2);
});
