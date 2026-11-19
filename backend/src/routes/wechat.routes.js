const { randomUUID } = require('node:crypto');
const express = require('express');
const { HttpError } = require('../utils/http-error');
const { openDocumentMcp } = require('../mcp/document.client');
const { WECHAT_EXPORT_TOOL, planWechatExport } = require('../services/wechat-export.service');

const localHosts = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
const localAddresses = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

function assertLocalRequest(req) {
  const origin = req.get('Origin');
  let sameMachine = !origin;
  if (origin) {
    try {
      const url = new URL(origin);
      sameMachine = ['http:', 'https:'].includes(url.protocol) && localHosts.has(url.hostname);
    } catch {
      sameMachine = false;
    }
  }
  if (!localAddresses.has(req.socket.remoteAddress) || !localHosts.has(req.hostname) || !sameMachine) {
    throw new HttpError(403, '微信整理仅支持本机网页或本机客户端', 'WECHAT_LOCAL_ONLY');
  }
}

function createWechatRouter({ config, documentService, arkClient }) {
  const router = express.Router();
  router.post('/revision-checklist', async (req, res) => {
    assertLocalRequest(req);
    if (!config.wechatMcp) throw new HttpError(503, '请先在后端配置本机微信 MCP', 'WECHAT_MCP_REQUIRED');
    const request = typeof req.body?.request === 'string' ? req.body.request.trim() : '';
    if (!request || request.length > 1200) {
      throw new HttpError(400, '请输入一句不超过 1200 字符的整理要求', 'INVALID_WECHAT_REQUEST');
    }

    const disconnected = new AbortController();
    const timeout = AbortSignal.timeout(config.fileProcessingTimeoutMs);
    const signal = AbortSignal.any([disconnected.signal, timeout]);
    const onClose = () => {
      if (!res.writableFinished) disconnected.abort();
    };
    res.once('close', onClose);
    let connection;
    try {
      const args = await planWechatExport({ config, arkClient, request, signal });
      connection = await openDocumentMcp({
        config, documentService, arkClient, scopeId: randomUUID(), fileIds: [], signal,
        timeoutMs: config.fileProcessingTimeoutMs
      });
      const result = await connection.client.callTool({ name: WECHAT_EXPORT_TOOL, arguments: args }, {
        signal, timeout: config.fileProcessingTimeoutMs
      });
      signal.throwIfAborted();
      if (result.isError) {
        const error = result.structuredContent?.error;
        throw new HttpError(error?.status || 502, error?.message || '微信整理失败', error?.code || 'WECHAT_EXPORT_FAILED');
      }
      const { filename, mediaType, contentBase64 } = result.structuredContent;
      const extension = args.format === 'markdown' ? 'md' : 'docx';
      res.set({
        'Content-Type': mediaType,
        'Content-Disposition': 'attachment; filename="wechat-revision.' + extension + '"; filename*=UTF-8\'\'' + encodeURIComponent(filename),
        'Cache-Control': 'no-store'
      }).send(Buffer.from(contentBase64, 'base64'));
    } catch (error) {
      if (disconnected.signal.aborted) return;
      if (timeout.aborted) throw new HttpError(504, '微信整理超时，请缩小日期范围后重试', 'WECHAT_EXPORT_TIMEOUT');
      throw error;
    } finally {
      res.off('close', onClose);
      if (connection) await Promise.allSettled([connection.client.close(), connection.server.close()]);
    }
  });
  return router;
}

module.exports = { createWechatRouter };
