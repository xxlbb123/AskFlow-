const path = require('node:path');
const dotenv = require('dotenv');

function readInteger(env, name, fallback, min, max = Number.MAX_SAFE_INTEGER) {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${name} 必须是 ${min} 到 ${max} 之间的整数`);
  }
  return value;
}

function createConfig(env = process.env) {
  const apiKey = env.ARK_API_KEY?.trim();
  const modelId = env.ARK_MODEL_ID?.trim();
  if (!apiKey || !modelId) {
    throw new Error('请在 backend/.env 中配置 ARK_API_KEY 和 ARK_MODEL_ID');
  }

  const baseUrl = (env.ARK_BASE_URL || 'https://ark.cn-beijing.volces.com/api/v3').replace(/\/+$/, '');
  let url;
  try { url = new URL(baseUrl); } catch { throw new Error('ARK_BASE_URL 必须是有效的 HTTP 或 HTTPS 地址'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.search || url.hash) {
    throw new Error('ARK_BASE_URL 必须是有效的 HTTP 或 HTTPS 地址，且不包含查询参数或锚点');
  }

  const corsOrigins = (env.CORS_ORIGIN || '*').split(',').map(value => value.trim()).filter(Boolean);
  const embeddingDimensions = readInteger(env, 'ARK_EMBEDDING_DIMENSIONS', 1024, 1024, 2048);
  if (![1024, 2048].includes(embeddingDimensions)) {
    throw new Error('ARK_EMBEDDING_DIMENSIONS 必须是 1024 或 2048');
  }
  return {
    port: readInteger(env, 'PORT', 3000, 0, 65535),
    apiKey,
    modelId,
    embeddingModelId: env.ARK_EMBEDDING_MODEL_ID?.trim() || 'doubao-embedding-vision-251215',
    embeddingDimensions,
    arkBaseUrl: baseUrl,
    requestTimeoutMs: readInteger(env, 'ARK_REQUEST_TIMEOUT_MS', 120000, 1, 2147483647),
    maxTokens: readInteger(env, 'ARK_MAX_TOKENS', 4000, 1),
    jsonBodyLimit: env.JSON_BODY_LIMIT || '1mb',
    corsOrigin: corsOrigins.includes('*') ? '*' : corsOrigins,
    documentStorageDir: path.resolve(__dirname, '../../', env.DOCUMENT_STORAGE_DIR || 'storage/documents'),
    fileMaxBytes: readInteger(env, 'FILE_MAX_BYTES', 2 * 1024 * 1024, 1),
    fileProcessingTimeoutMs: readInteger(env, 'FILE_PROCESSING_TIMEOUT_MS', 300000, 1, 2147483647),
    documentContextBudget: readInteger(env, 'DOCUMENT_CONTEXT_BUDGET', 12000, 6000),
    documentMaxSearchRounds: readInteger(env, 'DOCUMENT_MAX_SEARCH_ROUNDS', 3, 1, 5),
    inputBudget: readInteger(env, 'CHAT_INPUT_BUDGET', 48000, 16000)
  };
}

function loadConfig() {
  // 使用固定路径，从项目根目录启动后端时也能找到同一份配置。
  dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });
  return createConfig();
}

module.exports = { createConfig, loadConfig };
