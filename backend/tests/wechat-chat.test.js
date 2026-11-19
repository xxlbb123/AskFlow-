const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const test = require('node:test');
const { randomUUID } = require('node:crypto');
const { createApp } = require('../src/app');
const { createConfig } = require('../src/config/env');

const wordRequest = '整理我跟王老师 2026 年 11 月 3 日 10 点到 10 点半的微信聊天记录里的论文意见，导出 Word。';
const unavailableRequest = '整理无障碍测试会话 11 月 3 日 10 点到 10 点半的微信聊天记录。';
const incompleteRequest = '把和王老师的微信聊天整理成 Markdown';
const supplement = '2026 年 11 月 3 日上午 10 点到 10 点半';
const quote = '表 2 要补充标准差。';
const automaticVoice = '给表 2 补上标准差。';
const editedVoice = '请给表 2 加上 95% CI 和【听不清】。';
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

test('main chat reads and transcribes, shows records for editing, then generates files from approved text', { timeout: 25000 }, async t => {
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
      if (latest === unavailableRequest) return tool('exportWechatRevisionChecklist', {
        contact: '无障碍测试会话', from: '2026-11-03T10:00', to: '2026-11-03T10:30'
      });
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

    const input = JSON.parse(latest);
    if (input.items) {
      const uncertain = input.items[1].category === '待确认';
      const groups = uncertain ? [
        { category: '图表', action: '输出标准差', itemIds: [1] },
        { category: '图表', action: '核对 95% CI 的改法', itemIds: [2] }
      ] : [{ category: '图表', action: '在表 2 报告标准差', itemIds: [1, 2] }];
      return modelReply({ content: JSON.stringify({ groups }) });
    }
    extracts++;
    assert.equal(input.advisor, '王老师');
    const text = input.chunks[0].text;
    assert.doesNotMatch(text, /范围之前|随机种子|未播放|\[语音\]/);
    const voiceQuote = text.includes(editedVoice) ? editedVoice : automaticVoice;
    if (voiceQuote === editedVoice) assert.doesNotMatch(text, /给表 2 补上标准差/);
    return modelReply({ content: JSON.stringify({ items: [quote, voiceQuote].map(value => ({
      category: '图表', action: value, evidence: [{ quote: value, chunkId: input.chunks[0].id }]
    })) }) });
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
  const scopeId = randomUUID();
  async function send(messages, { host = base, origin, wechatReview, scope = scopeId } = {}) {
    const response = await fetch(host + '/api/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...(origin && { Origin: origin }) },
      body: JSON.stringify({ messages, scopeId: scope, wechatReview })
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
  const unavailable = await send([user(unavailableRequest)]);
  assert.match(textOf(unavailable), /可读取的聊天控件.*自动化兼容问题/);
  assert.ok(unavailable.every(event => !['wechat-review', 'download'].includes(event.type)));
  assert.equal(extracts, 0);

  const wordReviewEvents = await send([user(wordRequest)]);
  assert.equal(wordReviewEvents[0].type, 'status');
  assert.equal(wordReviewEvents.some(event => event.type === 'download'), false);
  assert.equal(extracts, 0);
  const wordReview = wordReviewEvents.find(event => event.type === 'wechat-review').review;
  assert.equal(wordReview.scopeId, scopeId);
  assert.deepEqual(wordReview.rows.map(row => [row.when.slice(-5), row.source, row.text]), [
    ['10:00', 'chat', quote], ['10:15', 'wechatVoice', automaticVoice], ['10:20', 'wechatVoice', '']
  ]);
  const reviewUrl = `${base}/api/wechat/reviews/${scopeId}/${wordReview.id}`;
  assert.deepEqual(await (await fetch(reviewUrl)).json(), wordReview);
  assert.equal((await fetch(`${base}/api/wechat/reviews/${randomUUID()}/${wordReview.id}`)).status, 404);
  assert.equal((await fetch(reviewUrl, { headers: { Origin: 'https://example.invalid' } })).status, 403);
  const edited = { id: wordReview.id, edits: [{ index: 1, text: editedVoice }] };
  const notYet = await send([user('现在还不要生成')], { wechatReview: edited });
  assert.match(textOf(notYet), /普通聊天回复/);
  assert.equal(extracts, 0);

  const wordEvents = await send([user('确认整理')], { wechatReview: edited });
  assert.match(textOf(wordEvents), /已合并出 2 项/);
  assert.deepEqual(wordEvents.find(event => event.type === 'wechat-review-closed'), {
    type: 'wechat-review-closed', id: wordReview.id, status: 'confirmed'
  });
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
  assert.equal((await fetch(reviewUrl)).status, 404);
  const retry = await send([user('确认整理')], { wechatReview: edited });
  assert.deepEqual(retry.find(event => event.type === 'download').file, word);

  const followUp = textOf(await send([user(incompleteRequest)]));
  assert.match(followUp, /请补充微信整理条件。发一下起止日期或时间。/);
  assert.equal(extracts, 1);
  const markdownReview = await send([user(incompleteRequest), { role: 'assistant', content: followUp }, user(supplement)]);
  const { id } = markdownReview.find(event => event.type === 'wechat-review').review;
  const markdownEvents = await send([user('确认整理，导出 Markdown')], { wechatReview: { id } });
  const markdown = markdownEvents.find(event => event.type === 'download').file;
  assert.equal(markdown.format, 'markdown');
  const downloadedMarkdown = await fetch(`${base}/api/wechat/reports/${markdown.id}/markdown`);
  assert.equal(downloadedMarkdown.status, 200);
  const markdownText = await downloadedMarkdown.text();
  assert.match(markdownText, /在表 2 报告标准差/);
  assert.match(markdownText, /1 条语音缺少转写文字，请按发送时间 2026-11-03 10:20/);
  assert.equal(extracts, 2);
});
