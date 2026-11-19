const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { openDocumentMcp } = require('../mcp/document.client');
const { WECHAT_EXPORT_TOOL } = require('./wechat-export.service');
const { isId } = require('./document.service');
const { HttpError } = require('../utils/http-error');

const formats = {
  docx: { extension: 'docx', mediaType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
  markdown: { extension: 'md', mediaType: 'text/markdown' }
};
const reportDir = config => path.join(config.documentStorageDir, 'wechat-reports');

function reportFile(format) {
  if (!Object.hasOwn(formats, format)) throw new HttpError(404, '微信清单不存在', 'WECHAT_REPORT_NOT_FOUND');
  const { extension, mediaType } = formats[format];
  return { extension, mediaType, filename: `微信论文修改清单.${extension}` };
}

async function requestWechatReport({ config, documentService, arkClient, args, signal }) {
  const { client, server } = await openDocumentMcp({
    config, documentService, arkClient, scopeId: randomUUID(), fileIds: [], signal,
    timeoutMs: config.fileProcessingTimeoutMs
  });
  try {
    const result = await client.callTool({ name: WECHAT_EXPORT_TOOL, arguments: args }, {
      signal, timeout: config.fileProcessingTimeoutMs
    });
    signal?.throwIfAborted();
    if (result.isError) {
      const error = result.structuredContent?.error;
      throw new HttpError(error?.status || 502, error?.message || '微信整理失败', error?.code || 'WECHAT_EXPORT_FAILED');
    }
    const payload = result.structuredContent;
    const file = reportFile(args.format);
    if (!payload || payload.mediaType !== file.mediaType || typeof payload.contentBase64 !== 'string' ||
        !payload.contentBase64 || !Number.isInteger(payload.itemCount) || payload.itemCount < 0) {
      throw new HttpError(502, '微信整理没有返回有效的清单', 'INVALID_WECHAT_REPORT');
    }
    return { ...file, buffer: Buffer.from(payload.contentBase64, 'base64'), itemCount: payload.itemCount };
  } finally {
    await Promise.allSettled([client.close(), server.close()]);
  }
}

async function saveWechatReport({ config, format, report, signal }) {
  const folder = reportDir(config);
  const id = randomUUID();
  const filename = path.join(folder, `${id}.${report.extension}`);
  signal?.throwIfAborted();
  await fs.mkdir(folder, { recursive: true });
  const file = await fs.open(filename, 'wx', 0o600);
  try {
    try { await file.writeFile(report.buffer, { signal }); }
    finally { await file.close(); }
    signal?.throwIfAborted();
  } catch (error) {
    await fs.unlink(filename).catch(() => {});
    throw error;
  }
  return { id, format };
}

async function readWechatReport(config, id, format) {
  const file = reportFile(format);
  if (!isId(id)) throw new HttpError(404, '微信清单不存在', 'WECHAT_REPORT_NOT_FOUND');
  try {
    const buffer = await fs.readFile(path.join(reportDir(config), `${id}.${file.extension}`));
    return { ...file, buffer };
  } catch (error) {
    if (error.code === 'ENOENT') throw new HttpError(404, '微信清单不存在，请重新生成', 'WECHAT_REPORT_NOT_FOUND');
    throw error;
  }
}

module.exports = { requestWechatReport, saveWechatReport, readWechatReport };
