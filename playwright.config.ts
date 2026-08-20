import { defineConfig, devices } from "@playwright/test"

/**
 * Playwright config for ARIA Mission Control v42 E2E tests.
 *
 * Auto-starts the dev server on port 3000 before tests + tears it down after.
 * Tests hit real API routes + real SQLite DB.
 *
 * Run: bunx playwright test
 * Run with UI: bunx playwright test --ui
 * Run single file: bunx playwright test tests/e2e/auth-2fa.spec.ts
 */

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false, // sequential — tests share a DB
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1, // single worker — DB state is shared
  reporter: process.env.CI ? "github" : "html",
  timeout: 60_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    actionTimeout: 15_000,
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],

  // Auto-start the dev server before tests + tear down after
  webServer: {
    command: "bun run dev",
    url: "http://localhost:3000/api/health",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: "pipe",
    stderr: "pipe",
  },
})
