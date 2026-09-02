import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  // A cold Vite dependency pre-bundle (notably lightweight-charts) can take
  // longer than Playwright's 30s default on Windows CI.
  timeout: 60_000,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://127.0.0.1:5173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    viewport: { width: 1280, height: 800 }
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } }
  ],
  webServer: {
    command: "powershell -NoProfile -Command \"$env:DISABLE_BACKGROUND_JOBS='1'; npm run dev\"",
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000
  }
});
