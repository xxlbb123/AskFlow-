const express = require('express');
const cors = require('cors');
const { createArkClient } = require('./clients/ark.client');
const { createEmbeddingClient } = require('./clients/embedding.client');
const { createChatService } = require('./services/chat.service');
const { createChatRouter } = require('./routes/chat.routes');
const { createDocumentService } = require('./services/document.service');
const { createFileRouter } = require('./routes/file.routes');
const { errorHandler, notFoundHandler } = require('./middleware/error-handler');

// 创建应用和监听端口分开，测试时可以使用独立端口和模拟的 AI 服务。
function createApp({ config, fetchImpl = globalThis.fetch, embeddingClient = createEmbeddingClient({ config, fetchImpl }) }) {
  const app = express();
  const arkClient = createArkClient({ config, fetchImpl });
  const documentService = createDocumentService({ config, embeddingClient });
  const chatService = createChatService({ config, arkClient, documentService });

  app.disable('x-powered-by');
  app.use(cors({
    origin: config.corsOrigin,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type']
  }));
  app.use(express.json({ limit: config.jsonBodyLimit }));

  app.get('/health', (req, res) => {
    res.json({ status: 'ok', message: 'AI Chat API is running' });
  });
  app.use('/api/chat', createChatRouter({ config, chatService }));
  app.use('/api/files', createFileRouter({ config, documentService }));

  // 未匹配的接口和所有错误都在路由之后处理。
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

module.exports = { createApp };
