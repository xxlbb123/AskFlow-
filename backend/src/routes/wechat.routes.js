const express = require('express');
const { HttpError } = require('../utils/http-error');
const { isLocalRequest, localOnlyMessage } = require('../utils/local-request');
const { voiceTranscriptsSchema, planWechatExport } = require('../services/wechat-export.service');
const { requestWechatReport, readWechatReport } = require('../services/wechat-reports.service');

function sendReport(res, { mediaType, extension, filename, buffer }) {
  res.set({
    'Content-Type': mediaType,
    'Content-Disposition': `attachment; filename="wechat-revision.${extension}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    'Cache-Control': 'no-store'
  }).send(buffer);
}

function createWechatRouter({ config, documentService, arkClient }) {
  const router = express.Router();
  router.use((req, res, next) => {
    if (!isLocalRequest(req)) throw new HttpError(403, localOnlyMessage, 'WECHAT_LOCAL_ONLY');
    next();
  });
  router.get('/reports/:id/:format', async (req, res) => {
    sendReport(res, await readWechatReport(config, req.params.id, req.params.format));
  });
  router.post('/revision-checklist', async (req, res) => {
    if (!config.wechatMcp) throw new HttpError(503, '请先在后端配置本机微信 MCP', 'WECHAT_MCP_REQUIRED');
    const request = typeof req.body?.request === 'string' ? req.body.request.trim() : '';
    if (!request || request.length > 1200) {
      throw new HttpError(400, '请输入一句不超过 1200 字符的整理要求', 'INVALID_WECHAT_REQUEST');
    }

    const voices = voiceTranscriptsSchema.safeParse(req.body.voiceTranscripts);
    if (!voices.success) {
      throw new HttpError(400, '请为每段语音填写有效的发送时间、发言人和转写文字', 'INVALID_VOICE_TRANSCRIPT');
    }

    const disconnected = new AbortController();
    const timeout = AbortSignal.timeout(config.fileProcessingTimeoutMs);
    const signal = AbortSignal.any([disconnected.signal, timeout]);
    const onClose = () => {
      if (!res.writableFinished) disconnected.abort();
    };
    res.once('close', onClose);
    try {
      const args = await planWechatExport({ config, arkClient, request, signal });
      const report = await requestWechatReport({
        config, documentService, arkClient, args: { ...args, voiceTranscripts: voices.data }, signal
      });
      signal.throwIfAborted();
      sendReport(res, report);
    } catch (error) {
      if (disconnected.signal.aborted) return;
      if (timeout.aborted) throw new HttpError(504, '微信整理超时，请缩小日期范围后重试', 'WECHAT_EXPORT_TIMEOUT');
      throw error;
    } finally {
      res.off('close', onClose);
    }
  });
  return router;
}

module.exports = { createWechatRouter };
