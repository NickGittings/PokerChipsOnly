import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './scripts',
  testMatch: 'browser.spec.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  use: { baseURL: 'http://127.0.0.1:3301', browserName: 'chromium', channel: process.env.PLAYWRIGHT_CHANNEL, trace: 'retain-on-failure' },
  webServer: {
    command: 'env PORT=3301 STATE_FILE=:memory: LAN_URL=http://127.0.0.1:3301 npm start',
    url: 'http://127.0.0.1:3301/api/health',
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
