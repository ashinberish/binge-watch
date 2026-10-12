import { defineConfig, devices } from '@playwright/test'

const baseURL = process.env['E2E_BASE_URL'] ?? 'http://localhost:4173'

/**
 * Smoke tests against the built app. Set E2E_BASE_URL to target a running deployment;
 * otherwise a preview server is started. In CI without browsers/server, set SKIP_E2E=1.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 2 : 0,
  reporter: process.env['CI'] ? 'github' : 'list',
  use: { baseURL, trace: 'on-first-retry' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: process.env['E2E_BASE_URL']
    ? undefined
    : {
        command: 'pnpm build && pnpm preview --port 4173 --strictPort',
        url: baseURL,
        reuseExistingServer: !process.env['CI'],
        timeout: 120_000,
      },
})
