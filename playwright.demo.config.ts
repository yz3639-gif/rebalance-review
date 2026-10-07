import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/demo',
  outputDir: 'demo-test-results',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: process.env.CI ? 2 : 3,
  timeout: 45_000,
  reporter: [['list']],
  use: { baseURL: 'http://127.0.0.1:4175/rebalance-review/', screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
  webServer: {
    command: 'npm run preview:demo',
    url: 'http://127.0.0.1:4175/rebalance-review/',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
