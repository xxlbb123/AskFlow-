const { createApp } = require('./src/app');
const { loadConfig } = require('./src/config/env');

// 入口只负责读取配置和启动服务，接口逻辑放在 src 中。
if (require.main === module) {
  const config = loadConfig();
  const app = createApp({ config });
  // Express 5 在监听失败时也会调用这个回调，必须先处理 error。
  const server = app.listen(config.port, (error) => {
    if (error) {
      console.error(error.code === 'EADDRINUSE'
        ? `端口 ${config.port} 已被占用，请停止原来的后端服务后重试。`
        : `后端启动失败：${error.message}`);
      process.exitCode = 1;
      return;
    }
    console.log(`AI Chat API is running on http://localhost:${server.address().port}`);
  });
}

module.exports = { createApp };
