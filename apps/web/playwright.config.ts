import { defineConfig, devices } from '@playwright/test';

const ROOT = '../..';

export default defineConfig({
  testDir: './e2e',
  timeout: 120_000,
  expect: { timeout: 30_000 },
  retries: 0,
  reporter: [['list']],
  use: { baseURL: 'http://localhost:3000', trace: 'retain-on-failure', viewport: { width: 1440, height: 900 } },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'pnpm --filter @aurum/server start',
      cwd: ROOT,
      url: 'http://localhost:4000/api/health',
      reuseExistingServer: true,
      timeout: 120_000,
      env: { MARKET_DATA_PROVIDER: 'replay', LLM_PROVIDER: 'none', REPLAY_SPEED: '600', LOG_LEVEL: 'warn' },
    },
    {
      command: 'pnpm --filter @aurum/web dev',
      cwd: ROOT,
      url: 'http://localhost:3000',
      reuseExistingServer: true,
      timeout: 180_000,
    },
  ],
});
