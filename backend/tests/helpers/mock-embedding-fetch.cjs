const { fixtureEmbedding } = require('./embedding');

// Loaded only by stdio tests through Node's --require option, never by the application.
globalThis.fetch = async (endpoint, options = {}) => {
  options.signal?.throwIfAborted();
  const url = new URL(String(endpoint));
  if (options.method !== 'POST' || !url.pathname.endsWith('/embeddings/multimodal')) {
    throw new Error('Unexpected network request in the isolated stdio embedding test');
  }
  const payload = JSON.parse(options.body);
  const text = payload.input?.[0]?.text;
  if (typeof text !== 'string' || !Number.isInteger(payload.dimensions)) {
    throw new Error('Invalid embedding request in the stdio test');
  }
  const role = payload.instructions.includes('Compress the text') ? 'corpus' : 'query';
  return Response.json({ data: { embedding: fixtureEmbedding(text, { role, dimensions: payload.dimensions }) } });
};
