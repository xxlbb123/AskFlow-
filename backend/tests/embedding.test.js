const assert = require('node:assert/strict');
const test = require('node:test');
const { createConfig } = require('../src/config/env');
const { createEmbeddingClient, embeddingProfile } = require('../src/clients/embedding.client');

const config = overrides => ({
  ...createConfig({ ARK_API_KEY: 'test-key', ARK_MODEL_ID: 'chat-model' }),
  ...overrides
});
const vector = dimensions => Array.from({ length: dimensions }, (_, index) => index === 0 ? 0.5 : 0);
const expectCode = code => error => error.code === code;

test('embedding configuration defaults to Doubao 1024 dimensions and accepts only supported dimensions', () => {
  assert.equal(config().embeddingModelId, 'doubao-embedding-vision-251215');
  assert.equal(config().embeddingDimensions, 1024);
  assert.equal(config().fileProcessingTimeoutMs, 300000);
  const custom = createConfig({
    ARK_API_KEY: 'test-key', ARK_MODEL_ID: 'chat-model',
    ARK_EMBEDDING_MODEL_ID: ' ep-embedding ', ARK_EMBEDDING_DIMENSIONS: '2048'
  });
  assert.equal(custom.embeddingModelId, 'ep-embedding');
  assert.equal(custom.embeddingDimensions, 2048);
  for (const value of ['512', '1536', '2049', 'text']) {
    assert.throws(() => createConfig({
      ARK_API_KEY: 'test-key', ARK_MODEL_ID: 'chat-model', ARK_EMBEDDING_DIMENSIONS: value
    }), /ARK_EMBEDDING_DIMENSIONS/);
  }
  assert.throws(() => createConfig({
    ARK_API_KEY: 'test-key', ARK_MODEL_ID: 'chat-model', FILE_PROCESSING_TIMEOUT_MS: '0'
  }), /FILE_PROCESSING_TIMEOUT_MS/);
  assert.equal(embeddingProfile, 'doubao-text-retrieval-v1');
});

test('embedding uses the multimodal endpoint, one input and distinct query/corpus instructions', async () => {
  const requests = [];
  const expected = vector(1024);
  const client = createEmbeddingClient({ config: config(), fetchImpl: async (url, options) => {
    requests.push({ url, options, body: JSON.parse(options.body) });
    return Response.json({ data: { embedding: expected } });
  } });
  assert.deepEqual(await client.embed('E3 怎么处理？'), expected);
  assert.deepEqual(await client.embed('原文说明 E3 的处理方法。', { role: 'corpus' }), expected);
  for (const request of requests) {
    assert.equal(request.url, 'https://ark.cn-beijing.volces.com/api/v3/embeddings/multimodal');
    assert.equal(request.options.method, 'POST');
    assert.equal(request.options.headers.Authorization, 'Bearer test-key');
    assert.equal(request.options.headers['Content-Type'], 'application/json');
    assert.ok(request.options.signal instanceof AbortSignal);
    assert.equal(request.body.model, 'doubao-embedding-vision-251215');
    assert.equal(request.body.dimensions, 1024);
    assert.equal(request.body.encoding_format, 'float');
    assert.equal(request.body.input.length, 1);
  }
  assert.deepEqual(requests[0].body.input, [{ type: 'text', text: 'E3 怎么处理？' }]);
  assert.equal(requests[0].body.instructions,
    'Target_modality: text.\nInstruction:根据这个问题，检索能够回答问题的相关文档片段。\nQuery:');
  assert.equal(requests[1].body.instructions, 'Instruction:Compress the text into one word.\nQuery:');
});

test('a configured endpoint/model and 2048-dimensional vector are used together', async () => {
  const expected = vector(2048);
  const client = createEmbeddingClient({
    config: config({ arkBaseUrl: 'https://example.test/api/v3', embeddingModelId: 'ep-embedding', embeddingDimensions: 2048 }),
    fetchImpl: async (url, options) => {
      assert.equal(url, 'https://example.test/api/v3/embeddings/multimodal');
      const payload = JSON.parse(options.body);
      assert.equal(payload.model, 'ep-embedding');
      assert.equal(payload.dimensions, 2048);
      return Response.json({ data: { embedding: expected } });
    }
  });
  assert.deepEqual(await client.embed('查询'), expected);
});

test('network errors become readable gateway errors without copying request details', async () => {
  const client = createEmbeddingClient({ config: config(), fetchImpl: async () => {
    throw new Error('test-key sensitive document contents');
  } });
  await assert.rejects(client.embed('原文'), error => {
    assert.equal(error.status, 502);
    assert.equal(error.code, 'EMBEDDING_UNAVAILABLE');
    assert.doesNotMatch(error.message, /test-key|sensitive/);
    return true;
  });
});

test('HTTP failures and error payloads are never accepted as vectors', async () => {
  for (const status of [400, 401, 429, 503]) {
    const client = createEmbeddingClient({ config: config(), fetchImpl: async () =>
      Response.json({ error: { message: 'test-key sensitive contents' } }, { status })
    });
    await assert.rejects(client.embed('原文'), error => {
      assert.equal(error.status, 502);
      assert.equal(error.code, 'EMBEDDING_UPSTREAM_ERROR');
      assert.match(error.message, new RegExp(`HTTP ${status}`));
      assert.doesNotMatch(error.message, /test-key|sensitive/);
      return true;
    });
  }
  const client = createEmbeddingClient({ config: config(), fetchImpl: async () =>
    Response.json({ error: { message: 'upstream failed' } })
  });
  await assert.rejects(client.embed('原文'), expectCode('EMBEDDING_UPSTREAM_ERROR'));
});

test('malformed JSON and invalid vector data are rejected', async () => {
  const malformed = createEmbeddingClient({ config: config(), fetchImpl: async () => new Response('{') });
  await assert.rejects(malformed.embed('原文'), expectCode('EMBEDDING_INVALID_RESPONSE'));

  const invalidVectors = [undefined, [], 'base64-vector', vector(2048), Array(1024).fill(0)];
  for (const invalid of [NaN, Infinity, null, '0.5']) {
    const invalidVector = vector(1024);
    invalidVector[1] = invalid;
    invalidVectors.push(invalidVector);
  }
  for (const embedding of invalidVectors) {
    const client = createEmbeddingClient({ config: config(), fetchImpl: async () => ({
      ok: true, json: async () => ({ data: { embedding } })
    }) });
    await assert.rejects(client.embed('原文'), expectCode('EMBEDDING_INVALID_RESPONSE'));
  }
  const wrongShape = createEmbeddingClient({ config: config(), fetchImpl: async () =>
    Response.json({ data: [{ embedding: vector(1024) }] })
  });
  await assert.rejects(wrongShape.embed('原文'), expectCode('EMBEDDING_INVALID_RESPONSE'));
});

test('blank inputs and unsupported roles are rejected before making a request', async () => {
  const client = createEmbeddingClient({ config: config(), fetchImpl: () => assert.fail('invalid input must not be sent') });
  for (const text of ['', '  ', null, 123]) {
    await assert.rejects(client.embed(text), /向量化文本不能为空/);
  }
  await assert.rejects(client.embed('原文', { role: 'assistant' }), /corpus 或 query/);
});

test('caller cancellation before and during fetch preserves the original abort reason', async () => {
  const cancelled = new AbortController();
  const reason = new Error('user cancelled');
  cancelled.abort(reason);
  const unopened = createEmbeddingClient({ config: config(), fetchImpl: () => assert.fail('cancelled input must not be sent') });
  await assert.rejects(unopened.embed('原文', { signal: cancelled.signal }), error => error === reason);

  const controller = new AbortController();
  const client = createEmbeddingClient({ config: config(), fetchImpl: (url, { signal }) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    controller.abort(reason);
  }) });
  await assert.rejects(client.embed('原文', { signal: controller.signal }), error => error === reason);
});

test('caller cancellation also interrupts reading the response body', async () => {
  const controller = new AbortController();
  const reason = new Error('cancel while reading');
  const client = createEmbeddingClient({ config: config(), fetchImpl: async (url, { signal }) => ({
    ok: true,
    json: () => new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      controller.abort(reason);
    })
  }) });
  await assert.rejects(client.embed('原文', { signal: controller.signal }), error => error === reason);
});

test('request timeout covers connection and response-body reading', { timeout: 1000 }, async () => {
  const waitForAbort = signal => new Promise((resolve, reject) =>
    signal.addEventListener('abort', () => reject(signal.reason), { once: true })
  );
  const connect = createEmbeddingClient({ config: config({ requestTimeoutMs: 20 }),
    fetchImpl: (url, { signal }) => waitForAbort(signal)
  });
  await assert.rejects(connect.embed('原文'), expectCode('EMBEDDING_TIMEOUT'));
  const body = createEmbeddingClient({ config: config({ requestTimeoutMs: 20 }),
    fetchImpl: async (url, { signal }) => ({ ok: true, json: () => waitForAbort(signal) })
  });
  await assert.rejects(body.embed('原文'), expectCode('EMBEDDING_TIMEOUT'));
});
