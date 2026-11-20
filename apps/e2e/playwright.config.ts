import { defineConfig, devices } from '@playwright/test';

const SHELL_URL = process.env.E2E_SHELL_URL ?? 'http://localhost:5173';
const BACKEND_URL = process.env.E2E_BACKEND_URL ?? 'http://localhost:5080';
const slowMo = Number(process.env.E2E_SLOWMO ?? 0); // the e2e:headed script sets 300 so the run is followable

export default defineConfig({
  testDir: './tests',
  outputDir: './test-results',
  reporter: [['list'], ['html', { open: 'never', outputFolder: './playwright-report' }]],
  // The tests share one backend and mutate order flags: run them one at a time.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  globalSetup: './global-setup.ts',
  use: {
    baseURL: SHELL_URL,
    // The seed computes "today" in the kitchen's zone; match it so the app's today is the seeded today.
    timezoneId: 'Asia/Ho_Chi_Minh',
    locale: 'vi-VN',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // Slow down only when watched.
    launchOptions: { slowMo },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  // The two front-end dev servers. The backend stack is started outside Playwright (make stack-up).
  webServer: [
    {
      command: `VITE_ORDERS_API=orchard VITE_BACKEND_URL=${BACKEND_URL} pnpm --filter @bpb/orders dev`,
      url: 'http://localhost:5174/',
      reuseExistingServer: true,
      timeout: 120_000,
    },
    {
      command: 'pnpm --filter @bpb/shell dev',
      url: 'http://localhost:5173/',
      reuseExistingServer: true,
      timeout: 120_000,
    },
  ],
});
