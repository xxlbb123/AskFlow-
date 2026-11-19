const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const test = require('node:test');
const { createApp } = require('../src/app');
const { createConfig } = require('../src/config/env');

const wordRequest = '整理我跟王老师 2026 年 11 月 3 日 10 点到 10 点半的微信聊天记录里的论文意见，导出 Word。';
const incompleteRequest = '把和王老师的微信聊天整理成 Markdown';
const supplement = '2026 年 11 月 3 日上午 10 点到 10 点半';
const quote = '表 2 要补充标准差。';
const user = content => ({ role: 'user', content });
const modelReply = message => Response.json({ choices: [{ message }] });
const tool = (name, args) => modelReply({ tool_calls: [{
  id: 'test-tool', type: 'function', function: { name, arguments: JSON.stringify(args) }
}] });

function readEvents(body) {
  const events = body.split('\n').filter(line => line.startsWith('data: ')).map(line => line.slice(6));
  assert.equal(events.pop(), '[DONE]');
  return events.map(JSON.parse);
}

test('main chat routes WeChat requests to the MCP and provides local Word or Markdown downloads', { timeout: 25000 }, async t => {
  const storage = await fs.mkdtemp(path.join(os.tmpdir(), 'askflow-wechat-chat-'));
  t.after(() => fs.rm(storage, { recursive: true, force: true }));
  const env = { ARK_API_KEY: 'fake', ARK_MODEL_ID: 'fake', DOCUMENT_STORAGE_DIR: storage, DATABASE_PATH: ':memory:' };
  let plans = 0;
  let extracts = 0;
  let normalReplies = 0;
  const fetchImpl = async (_url, request) => {
    const payload = JSON.parse(request.body);
    const latest = payload.messages.at(-1).content;
    if (payload.stream) {
      normalReplies++;
      return new Response('data: {"choices":[{"delta":{"content":"普通聊天回复"}}]}\n\ndata: [DONE]\n\n', {
        headers: { 'Content-Type': 'text/event-stream' }
      });
    }
    if (payload.tools) {
      plans++;
      assert.deepEqual(payload.tools.map(entry => entry.function.name), ['exportWechatRevisionChecklist', 'askForWechatExportDetails']);
      if (latest === '微信的历史工具是怎么工作的？') return modelReply({ content: '这里是在问工作方式。' });
      if (latest === incompleteRequest) return tool('askForWechatExportDetails', { missing: ['time'] });
      if (latest === supplement) {
        assert.equal(payload.messages[1].content, incompleteRequest);
        assert.match(payload.messages[2].content, /请补充微信整理条件/);
      } else {
        assert.equal(latest, wordRequest);
      }
      return tool('exportWechatRevisionChecklist', {
        contact: '王老师', from: '2026-11-03T10:00', to: '2026-11-03T10:30',
        ...(latest === supplement && { format: 'markdown' })
      });
    }

    extracts++;
    const input = JSON.parse(latest);
    assert.equal(input.advisor, '王老师');
    assert.match(input.chunks[0].text, /表 2 要补充标准差/);
    assert.doesNotMatch(input.chunks[0].text, /范围之前|随机种子|语音/);
    return modelReply({ content: JSON.stringify({ items: [{
      category: '图表', action: '在表 2 报告标准差', evidence: [{ quote, chunkId: input.chunks[0].id }]
    }] }) });
  };

  async function start(options = {}) {
    const config = createConfig({ ...env, ...options });
    const app = createApp({ config, fetchImpl });
    const server = http.createServer(app).listen(0, '127.0.0.1');
    t.after(async () => {
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
      app.locals.db?.close();
    });
    await once(server, 'listening');
    return 'http://127.0.0.1:' + server.address().port;
  }
  const base = await start({
    WECHAT_MCP_COMMAND: process.execPath,
    WECHAT_MCP_ARGS: JSON.stringify([path.resolve(__dirname, 'helpers/wechat-mcp-fixture.cjs')])
  });
  async function send(messages, { host = base, origin } = {}) {
    const response = await fetch(host + '/api/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...(origin && { Origin: origin }) },
      body: JSON.stringify({ messages })
    });
    const body = await response.text();
    assert.equal(response.status, 200, body);
    return readEvents(body);
  }
  const textOf = events => events.flatMap(event => event.choices ?? []).map(choice => choice.delta.content).join('');

  assert.match(textOf(await send([user('写一个冒泡排序')])), /普通聊天回复/);
  assert.equal(plans, 0);
  assert.match(textOf(await send([user('微信的历史工具是怎么工作的？')])), /普通聊天回复/);
  assert.equal(plans, 1);
  assert.equal(normalReplies, 2);
  assert.equal(extracts, 0);

  const remote = await send([user(wordRequest)], { origin: 'https://example.invalid' });
  assert.match(textOf(remote), /仅支持本机/);
  assert.ok(remote.every(event => event.type !== 'download'));
  assert.equal(extracts, 0);
  const unconfigured = await start();
  assert.match(textOf(await send([user(wordRequest)], { host: unconfigured })), /WECHAT_MCP_COMMAND/);
  assert.equal(extracts, 0);

  const wordEvents = await send([user(wordRequest)]);
  assert.equal(wordEvents[0].type, 'status');
  assert.match(textOf(wordEvents), /已合并出 1 项/);
  const word = wordEvents.find(event => event.type === 'download').file;
  assert.equal(word.format, 'docx');
  assert.deepEqual(Object.keys(word).sort(), ['format', 'id']);
  const wordUrl = `${base}/api/wechat/reports/${word.id}/${word.format}`;
  const downloadedWord = await fetch(wordUrl);
  assert.equal(downloadedWord.status, 200);
  assert.match(downloadedWord.headers.get('content-disposition'), /wechat-revision\.docx/);
  assert.equal(Buffer.from(await downloadedWord.arrayBuffer()).subarray(0, 4).toString('hex'), '504b0304');
  assert.equal((await fetch(wordUrl, { headers: { Origin: 'https://example.invalid' } })).status, 403);
  assert.equal((await fetch(`${base}/api/wechat/reports/${word.id}/markdown`)).status, 404);
  assert.equal((await fetch(`${base}/api/wechat/reports/not-a-file/docx`)).status, 404);

  const followUp = textOf(await send([user(incompleteRequest)]));
  assert.match(followUp, /请补充微信整理条件。发一下起止日期或时间。/);
  assert.equal(extracts, 1);
  const markdownEvents = await send([user(incompleteRequest), { role: 'assistant', content: followUp }, user(supplement)]);
  const markdown = markdownEvents.find(event => event.type === 'download').file;
  assert.equal(markdown.format, 'markdown');
  const downloadedMarkdown = await fetch(`${base}/api/wechat/reports/${markdown.id}/markdown`);
  assert.equal(downloadedMarkdown.status, 200);
  assert.match(await downloadedMarkdown.text(), /在表 2 报告标准差/);
  assert.equal(extracts, 2);
});
