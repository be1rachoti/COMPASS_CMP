/**
 * End-to-end tests.
 *
 * These drive a real browser against a real API, which is the only way to test
 * the things that only exist in a browser: the HttpOnly session cookie, the
 * double-submit CSRF header, the Content Security Policy, and the consent
 * flow's multi-step state.
 */
import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 3100);

/**
 * `127.0.0.1` by default — the loopback address, which no browser treats
 * specially.
 */
const BASE_URL = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${PORT}`;

/**
 * The same server, reached by name instead of by address.
 *
 * This exists because of a specific bug that shipped once and cost a day. The
 * API is on `127.0.0.1:8000`; the console is opened at `localhost:3000`.
 * Browsers treat those as **different sites** for cookie purposes, so a session
 * cookie set `SameSite=Lax` is silently dropped on the next XHR — login returns
 * 200 and the following request is a 401, with nothing in either log to say
 * why.
 *
 * The `/api` rewrite in `next.config.ts` is what fixes it, by making the API
 * same-origin. Testing only on `127.0.0.1` would not have caught the original
 * bug and would not catch its return, because on that host the two names agree.
 * So the same specs run against `localhost` too, and if somebody removes the
 * rewrite the auth spec fails here rather than in somebody's browser.
 */
const LOCALHOST_URL = `http://localhost:${PORT}`;

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
  expect: {
    timeout: 5_000,
    toHaveScreenshot: {
      // Anti-aliasing differs between machines and between runs on the same
      // machine. A zero threshold produces a suite that fails for reasons
      // nobody can act on, which is how visual tests get disabled.
      maxDiffPixelRatio: 0.02,
      // Motion is the other source of noise: a chart that animates in settles
      // at a different frame each run. `stylePath` below stops it entirely.
      animations: "disabled",
      stylePath: "./e2e/screenshot.css",
    },
  },
  snapshotPathTemplate: "{testDir}/__screenshots__/{projectName}/{arg}{ext}",

  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },

  projects: [
    /**
     * Sign in once per role and save the session.
     *
     * Every authenticated project depends on this. Without it each test signs
     * in for itself, and four workers doing that as the same account trips the
     * API's login lockout - five attempts in thirty minutes - which then fails
     * the rest of the run for a reason that looks like an application bug.
     */
    { name: "setup", testMatch: /auth\.setup\.ts/ },

    /**
     * The behavioural suite. `testIgnore` matters: without it the visual specs
     * would also run here, against a viewport this project does not pin, and
     * every screenshot would be compared to a baseline captured at a different
     * size.
     */
    {
      name: "chromium",
      testIgnore: /visual\.spec\.ts/,
      dependencies: ["setup"],
      use: { ...devices["Desktop Chrome"] },
    },

    // The consent flow is used on phones at a collection site far more often
    // than on a desktop, so it is tested there too.
    {
      name: "mobile",
      testIgnore: /visual\.spec\.ts/,
      dependencies: ["setup"],
      use: { ...devices["Pixel 7"] },
    },

    /**
     * The host people actually type. Only the auth-sensitive specs run here —
     * running everything twice would double the suite for one class of bug, and
     * that class is entirely about cookies.
     */
    {
      name: "localhost-cookies",
      testMatch: /(auth|consent-flow)\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], baseURL: LOCALHOST_URL },
    },

    /**
     * Screenshots, kept apart from the behavioural specs.
     *
     * Pinned to one viewport and one device scale factor, because a snapshot
     * taken at a different size is a diff of the layout rather than of the
     * change under review.
     */
    {
      name: "visual",
      testMatch: /visual\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1280, height: 800 },
        deviceScaleFactor: 1,
        // Screenshots are compared against a committed baseline, and a
        // baseline in one theme says nothing about the other. Both are
        // captured; see the spec.
        colorScheme: "light",
      },
    },
  ],

  /**
   * A production build, not `next dev`.
   *
   * This is not a preference. `next dev` compiles routes on demand, so the
   * first request to a route pays for its compilation — and with four parallel
   * workers hitting different routes at once, that wait exceeded the assertion
   * timeout on roughly one run in five. The failures looked like application
   * bugs (an element "not found", a screenshot one paint early) and were
   * entirely the dev server.
   *
   * The tests that then failed passed individually, which is the signature of
   * this problem and the reason it wastes so much time: the obvious next step
   * is to investigate the test, and the test is fine.
   *
   * A build costs a minute up front and removes the whole class. For a fast
   * local loop against a dev server already running, set E2E_BASE_URL and
   * accept the flake knowingly.
   */
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: `npm run build && npm run start -- --port ${PORT}`,
        url: `${BASE_URL}/sign-in`,
        reuseExistingServer: !process.env.CI,
        // A cold build on a laptop is comfortably inside four minutes; the
        // default two would fail on a cold Next cache.
        timeout: 300_000,
      },
});
