// 画面のテスト（npm run test:e2e）。app/ を小さなサーバーで出して、Chromium で開く
const { defineConfig } = require('@playwright/test');
const PORT = 8799;
module.exports = defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: { baseURL: `http://localhost:${PORT}/`, locale: 'ja-JP', timezoneId: 'Asia/Tokyo', serviceWorkers: 'block' },
  webServer: { command: `node scripts/serve.js ${PORT}`, url: `http://localhost:${PORT}/`, reuseExistingServer: !process.env.CI },
});
