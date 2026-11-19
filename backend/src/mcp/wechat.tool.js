const { createArkClient } = require('../clients/ark.client');
const { HttpError } = require('../utils/http-error');
const { WECHAT_EXPORT_TOOL, wechatExportSchema, exportWechatRevision } = require('../services/wechat-export.service');

function registerWechatExportTool(server, { config, arkClient }) {
  if (!config.wechatMcp) return;
  const model = arkClient ?? createArkClient({ config });
  server.registerTool(WECHAT_EXPORT_TOOL, {
    description: '读取指定联系人和时段的微信记录，按论文主题归并导师意见并导出 Word 或 Markdown。',
    inputSchema: wechatExportSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true }
  }, async (input, context) => {
    const signal = context.mcpReq.signal;
    try {
      const report = await exportWechatRevision({ ...input, config, arkClient: model, signal });
      return {
        structuredContent: report,
        content: [
          { type: 'text', text: '整理出 ' + report.itemCount + ' 项。下载文件 ' + report.filename + '。' },
          { type: 'resource', resource: {
            uri: 'urn:askflow:report:' + encodeURIComponent(report.filename),
            mimeType: report.mediaType,
            blob: report.contentBase64
          } }
        ]
      };
    } catch (cause) {
      signal.throwIfAborted();
      const error = cause instanceof HttpError
        ? { status: cause.status, code: cause.code, message: cause.message }
        : { status: 502, code: 'WECHAT_EXPORT_FAILED', message: '微信记录整理失败，请重试' };
      return { isError: true, structuredContent: { error }, content: [{ type: 'text', text: error.message }] };
    }
  });
}

module.exports = { registerWechatExportTool };
