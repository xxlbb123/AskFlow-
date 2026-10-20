const { McpServer } = require('@modelcontextprotocol/server');
const z = require('zod');
const { HttpError } = require('../utils/http-error');
const { isId } = require('../services/document.service');

function createDocumentMcpServer({ config, documentService, fileIds, scopeId }) {
  if (!isId(scopeId)) {
    throw new HttpError(400, '无效的会话附件标识', 'INVALID_DOCUMENT_SCOPE');
  }
  const server = new McpServer({ name: 'yuan-chat-documents', version: '1.0.0' });

  // 指定 fileIds 时，只能使用其中的文件；未指定时，文档服务仍会检查文件属于当前会话。
  let fileIdSchema = z.string().uuid();
  if (fileIds) {
    fileIdSchema = z.enum(fileIds);
  }

  // inputSchema 是参数规则：SDK 用它描述工具，并在执行回调前检查参数。
  // 每个工具直接注册，参数、业务调用和返回结果放在一起阅读。
  server.registerTool('searchDocuments', {
    description: '按向量相似度批量检索当前文档。将多个问题组成 queries 一次查询，每个问题最多取 4 个相关分块，返回原文及来源位置；mode=full 表示全文分块，retrieval 表示相关片段。',
    inputSchema: z.object({
      fileId: fileIdSchema,
      queries: z.array(z.string().trim().min(1).max(1000)).min(1).max(8)
        .describe('本次需要回答的独立问题，最多 8 个')
    }).strict(), // 拒绝未声明的参数，例如 scopeId 或任意文件路径。
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async ({ fileId, queries }, context) => {
    const signal = context.mcpReq.signal;
    try {
      signal.throwIfAborted();
      const result = await documentService.searchBatch({ fileId, queries, scopeId, signal });
      signal.throwIfAborted();
      return {
        structuredContent: result,
        content: [{ type: 'text', text: JSON.stringify(result) }]
      };
    } catch (error) {
      signal.throwIfAborted();
      const detail = error instanceof HttpError
        ? { code: error.code, message: error.message, status: error.status }
        : { code: 'DOCUMENT_TOOL_FAILED', message: '文档操作失败，请重试', status: 502 };
      return {
        isError: true,
        structuredContent: { error: detail },
        content: [{ type: 'text', text: JSON.stringify({ error: detail }) }]
      };
    }
  });

  server.registerTool('readDocument', {
    description: '按分块顺序读取指定文档原文。搜索结果的 chunkId=chunk-N 对应 startChunk=N；需要补全上下文时使用，每次最多读取 6 块。',
    inputSchema: z.object({
      fileId: fileIdSchema,
      startChunk: z.number().int().min(1).default(1), // 默认从第 1 块开始。
      count: z.number().int().min(1).max(6).default(1) // 默认读 1 块，最多读 6 块。
    }).strict(),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async ({ fileId, startChunk, count }, context) => {
    const signal = context.mcpReq.signal;
    try {
      signal.throwIfAborted();
      const result = await documentService.readChunks({ fileId, startChunk, count, scopeId, signal });
      signal.throwIfAborted();
      return {
        structuredContent: result,
        content: [{ type: 'text', text: JSON.stringify(result) }]
      };
    } catch (error) {
      signal.throwIfAborted();
      const detail = error instanceof HttpError
        ? { code: error.code, message: error.message, status: error.status }
        : { code: 'DOCUMENT_TOOL_FAILED', message: '文档操作失败，请重试', status: 502 };
      return {
        isError: true,
        structuredContent: { error: detail },
        content: [{ type: 'text', text: JSON.stringify({ error: detail }) }]
      };
    }
  });

  server.registerTool('listDocuments', {
    description: '列出当前允许访问的文档元数据，包括文件 ID、名称和分块数量。',
    inputSchema: z.object({}).strict(), // 不需要参数，文件范围已经在创建 Server 时确定。
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async (args, context) => {
    const signal = context.mcpReq.signal; //这个signal是MCP SDK提供的本次工具调用的取消信号
    try {
      signal.throwIfAborted(); //这个意思是如果没有取消，继续执行
      const documents = await documentService.list({ scopeId, fileIds, signal });
      signal.throwIfAborted();
      const result = { documents };
      return {
        structuredContent: result, //方便程序直接读取的数据对象
        content: [{ type: 'text', text: JSON.stringify(result)  }] //同一份结果的文本形式，供客户端使用。
      };
    } catch (error) {
      signal.throwIfAborted(); //如果已经取消，那么就抛出取消原因，退出当前正常执行流程
      const detail = error instanceof HttpError
        ? { code: error.code, message: error.message, status: error.status }
        : { code: 'DOCUMENT_TOOL_FAILED', message: '文档操作失败，请重试', status: 502 };
      return {
        isError: true,
        structuredContent: { error: detail },
        content: [{ type: 'text', text: JSON.stringify({ error: detail }) }]
      };
    }
  });

  // Base64 每 3 个字节编码成 4 个字符，用文件大小上限计算字符串长度上限。
  const maxBase64Length = Math.ceil(config.fileMaxBytes / 3) * 4;
  
  server.registerTool('ingestDocuments', {
    description: '导入 UTF-8 TXT/MD 文档，切分并生成向量索引后保存原始文件和 JSON。原文件字节以 Base64 传输；用于程序上传流程。',
    inputSchema: z.object({
      documents: z.array(z.object({
        name: z.string(),
        dataBase64: z.string().base64().max(maxBase64Length)
      }).strict()).length(1) // 当前每次只上传一个文件。
    }).strict(),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
  }, async ({ documents }, context) => {
    const signal = context.mcpReq.signal;
    try {
      signal.throwIfAborted();
      const document = documents[0];
      const saved = await documentService.save({
        name: document.name,
        buffer: Buffer.from(document.dataBase64, 'base64'),
        scopeId,
        signal
      });
      signal.throwIfAborted();
      const result = { documents: [saved] };
      return {
        structuredContent: result,
        content: [{ type: 'text', text: JSON.stringify(result) }]
      };
    } catch (error) {
      signal.throwIfAborted();
      const detail = error instanceof HttpError
        ? { code: error.code, message: error.message, status: error.status }
        : { code: 'DOCUMENT_TOOL_FAILED', message: '文档操作失败，请重试', status: 502 };
      return {
        isError: true,
        structuredContent: { error: detail },
        content: [{ type: 'text', text: JSON.stringify({ error: detail }) }]
      };
    }
  });

  return server;
}

module.exports = { createDocumentMcpServer };
