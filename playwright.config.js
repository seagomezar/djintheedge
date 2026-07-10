import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright end-to-end configuration for BrowserDJ AI.
 *
 * The app is a Vite (vanilla JS) project served under the /djintheedge/ base
 * path. These specs exercise the REAL browser experience: on load the app tries
 * to spin up an on-device LLM via WebGPU which is unavailable in headless
 * Chromium, so it must transparently fall back to the rule-based parser and
 * remain fully functional. We intentionally do NOT pass --enable-unsafe-webgpu
 * because the fallback path is exactly what we want to verify.
 */
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.spec.js',
  timeout: 60_000,
  fullyParallel: false,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5173/djintheedge/',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173/djintheedge/',
    timeout: 120_000,
    reuseExistingServer: true,
  },
});
