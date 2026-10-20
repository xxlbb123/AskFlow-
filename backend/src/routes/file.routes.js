const express = require('express');
const { HttpError } = require('../utils/http-error');
const { openDocumentMcp } = require('../mcp/document.client');
// 这个是创建文件路由
// config：文件大小限制、处理超时时间等配置。
// documentService：实际处理文件、分块、生成向量等业务的对象。
// openMcp：建立 MCP 连接的函数。没有传入时，默认使用 openDocumentMcp。
function createFileRouter({ config, documentService, openMcp = openDocumentMcp }) {
  const router = express.Router();
  // HTTP 层接收字节、管理取消和响应；文档处理统一经过 MCP 工具。
  async function withDocuments(req, res, fileIds, execute) {
    // fileIds上传的时候还没有新文件ID
    const controller = new AbortController();
    // 监听连接关闭
    const onClose = () => {
      if (!res.writableFinished) 
        controller.abort(new DOMException('客户端已断开连接', 'AbortError'));
    };
    res.once('close', onClose);//注册一个只触发一次的事件监听
    // 设置处理超时，默认是进入该流程之后最多处理五分钟
    const timer = setTimeout(() =>
       controller.abort(new HttpError(504, '文件操作超时，请重试', 'FILE_OPERATION_TIMEOUT')
     ),
      config.fileProcessingTimeoutMs);
     
    timer.unref(); //timer.unref() 不会取消定时器，它只是让这个定时器不单独阻止 Node.js 进程退出。
    let connection;
    const callOptions = { 
      signal: controller.signal, 
      timeout: config.fileProcessingTimeoutMs 
    };//后续工具调用这个callOptions中的signal就能响应上面的取消通知
    try {
      connection = await openMcp({ 
        config, 
        documentService, 
        scopeId: req.query.scopeId, fileIds,
        timeoutMs: config.fileProcessingTimeoutMs, 
        signal: controller.signal });//这一步会得到connection = {
        // client // MCP Client，server //MCP Server}
      await execute(connection.client, callOptions);
    } catch (error) {
      if (res.destroyed && controller.signal.reason?.name === 'AbortError') return;
      if (controller.signal.aborted) throw controller.signal.reason;
      if (error instanceof HttpError) throw error;
      throw new HttpError(502, 'MCP 工具调用失败，请重试', 'MCP_TOOL_ERROR');
    } finally {
      clearTimeout(timer);
      res.off('close', onClose);//移除监听 
      // 关闭本次操作建立的连接
      if (connection) {
        await Promise.allSettled([
          connection.client.close(), 
          connection.server.close()]);
      }
    }
  }
  // 文件上传接口
  router.post('/', 
    //读取请求体,将请求体读成一个buffer,并放到req.body中
    express.raw({ 
      type: 'application/octet-stream', //处理 application/octet-stream 类型的请求。
      limit: config.fileMaxBytes, //限制请求体大小,这里为2M
      inflate: false //拒绝压缩的请求体
    }), 
    async (req, res) => {
      // 检查请求类型、文件名参数是否符合要求。具体文件内容是否合法
    if (!req.is('application/octet-stream')) 
      throw new HttpError(415, '上传需要使用 application/octet-stream', 'UNSUPPORTED_MEDIA_TYPE');
    if (typeof req.query.name !== 'string') 
      throw new HttpError(400, '文件名无效', 'INVALID_FILENAME');
    // 是我们自己定义的公共流程函数,准备MCP连接，注意此时anync(...)=>{...}这个函数还没有执行，
    await withDocuments(req, res, undefined, 
      async (client, callOptions) => {
        // 这里将文件转换成Base64字符串，并且调用ingestDocuments工具
      const result = await client.callTool({
        name: 'ingestDocuments',
        arguments: { 
          documents: [
          { name: req.query.name, 
            dataBase64: (req.body || Buffer.alloc(0)).toString('base64') } 
          ] 
        }
      }, callOptions);
      callOptions.signal.throwIfAborted();//检查等待期间是否已经取消
      if (result.isError) {
        const error = result.structuredContent?.error;
        throw new HttpError(error?.status || 502, error?.message || '文档导入失败', error?.code || 'MCP_TOOL_ERROR');
      }
      const { documents } = result.structuredContent;
      if (!res.destroyed) res.status(201).json({ file: documents[0] });//返回的是已经保存的文件的元数据，例如 ID、文件名、分块数量，供前端后续提问使用
    });
  });
  // 文件查询入口
  router.get('/:id', async (req, res) => {
    await withDocuments(req, res, [req.params.id], 
      async (client, callOptions) => {
        // 调用listDocuments，返回文件信息 
      const result = await client.callTool(
        { name: 'listDocuments', arguments: {} }, 
        callOptions);
      callOptions.signal.throwIfAborted();
      if (result.isError) {
        const error = result.structuredContent?.error;
        throw new HttpError(error?.status || 502, error?.message || '获取文件信息失败', error?.code || 'MCP_TOOL_ERROR');
      }
      const { documents } = result.structuredContent;
      if (!res.destroyed) res.json({ file: documents[0] });
    });
  });
  return router;
}

module.exports = { createFileRouter };
