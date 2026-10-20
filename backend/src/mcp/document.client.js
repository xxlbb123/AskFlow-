// Client 负责发送请求、接收响应；InMemoryTransport 在同一个进程中传递消息。
const { Client, InMemoryTransport } = require('@modelcontextprotocol/client');
const { createDocumentMcpServer } = require('./document.server');

// 这里只建立连接。调用方直接使用 SDK 的 listTools、callTool 和 close。
async function openDocumentMcp(options) {
  // options 包含配置、文档服务、会话范围、允许访问的文件，以及取消信号。
  const server = createDocumentMcpServer(options); // 工具提供方
  const client = new Client({ name: 'yuan-chat-api', version: '1.0.0' }); // 工具调用方
  // client和server是同一个node.js进程里的两个对象，消息在内存中传递
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  try {
    options.signal?.throwIfAborted();
    // 先让 Server 准备接收消息，再连接 Client。
    await server.connect(serverTransport);
    await client.connect(clientTransport, {
      signal: options.signal,
      timeout: options.timeoutMs ?? options.config.requestTimeoutMs
    });
    options.signal?.throwIfAborted();
    return { client, server };
  } catch (error) {
    // 建立连接失败时，两端都尝试关闭，再抛出原来的错误。
    await Promise.allSettled([client.close(), server.close()]);
    options.signal?.throwIfAborted();
    throw error;
  }
}

module.exports = { openDocumentMcp };
