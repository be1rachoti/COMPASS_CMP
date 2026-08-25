/**
 * End-to-end tests.
 *
 * These drive a real browser against a real API, which is the only way to test
 * the things that only exist in a browser: the HttpOnly session cookie, the
 * double-submit CSRF header, and the consent flow's multi-step state.
 */
import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 3100);
const BASE_URL = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  // A test that only passes on a retry is a flaky test, and a flaky test in the
  // consent flow is one nobody will trust. Fail the build if one is committed.
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["list"]],
  timeout: 30_000,
  expect: { timeout: 5_000 },

  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },

  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    // The consent flow is used on phones at a collection site far more often
    // than on a desktop, so it is tested there too.
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],

  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: `npm run dev -- --port ${PORT}`,
        url: `${BASE_URL}/sign-in`,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
});
