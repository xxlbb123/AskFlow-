const { StdioServerTransport } = require('@modelcontextprotocol/server/stdio');
const { loadConfig } = require('./src/config/env');
const { createDocumentService, isId } = require('./src/services/document.service');
const { createDocumentMcpServer } = require('./src/mcp/document.server');
// 这个文件作用是把我们的文档工具作为一个独立的mcp server 程序启动

async function main() {
  // 会话范围由启动参数绑定，工具参数不能切换到其他会话；可进一步限制为一个附件。
  const args = process.argv.slice(2);
  const scopeId = args[args.indexOf('--scope-id') + 1];
  const fileId = args.includes('--file-id') ? args[args.indexOf('--file-id') + 1] : undefined;
  if (!args.includes('--scope-id') || !isId(scopeId) || (args.includes('--file-id') && !isId(fileId))) {
    throw new Error('用法：node mcp.js --scope-id <UUID> [--file-id <UUID>]');
  }
  const config = loadConfig();
  // 创建文档服务业务 documentService
  const documentService = createDocumentService({ config });
  if (fileId) await documentService.read(fileId, scopeId);
  // 创建mcp server 并注册文档工具
  const server = createDocumentMcpServer({ config, documentService, fileIds: fileId ? [fileId] : undefined, scopeId });
  // 这是外部MCP客户端启动、连接的独立程序入口
  // 本质就是创建一个通过标准输入输出收发消息的通道，并且让mcp server使用这个通道
  await server.connect(new StdioServerTransport());
  // stdout 留给 MCP JSON-RPC 消息。
  console.error('AI Chat 文档 MCP 服务已启动（stdio）');
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { main };
