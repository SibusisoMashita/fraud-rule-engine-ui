import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30_000,
  expect: { timeout: 8_000 },
  reporter: 'list',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    timezoneId: 'UTC',
    ...devices['Desktop Chrome'],
    // Traces and HARs can record API-key headers. Keep them off.
    trace: 'off',
    video: 'off',
    screenshot: 'off',
  },
});
