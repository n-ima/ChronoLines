import { defineConfig, devices } from '@playwright/test';

// E2E テストの実装・実行はテストフェーズ（/07・/08）の管轄（tasks.md 共通事項）。
// webServer の url は /api/health（TASK-007 で実装）を疎通確認に使う。
export default defineConfig({
  testDir: './tests/e2e',
  use: {
    baseURL: 'http://127.0.0.1:5177',
  },
  webServer: {
    command: 'npm start',
    url: 'http://127.0.0.1:5177/api/health',
    reuseExistingServer: true,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
