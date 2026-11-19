const express = require('express');
const { HttpError } = require('../utils/http-error');
const { isLocalRequest, localOnlyMessage } = require('../utils/local-request');
const { readWechatReport } = require('../services/wechat-reports.service');

function sendReport(res, { mediaType, extension, filename, buffer }) {
  res.set({
    'Content-Type': mediaType,
    'Content-Disposition': `attachment; filename="wechat-revision.${extension}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    'Cache-Control': 'no-store'
  }).send(buffer);
}

function createWechatRouter({ config, wechatReviews }) {
  const router = express.Router();
  router.use((req, res, next) => {
    if (!isLocalRequest(req)) throw new HttpError(403, localOnlyMessage, 'WECHAT_LOCAL_ONLY');
    next();
  });
  router.get('/reports/:id/:format', async (req, res) => {
    sendReport(res, await readWechatReport(config, req.params.id, req.params.format));
  });
  router.get('/reviews/:scopeId/:id', (req, res) => {
    const { scopeId, id } = req.params;
    res.set('Cache-Control', 'no-store').json(wechatReviews.read(scopeId, id));
  });
  return router;
}

module.exports = { createWechatRouter };
