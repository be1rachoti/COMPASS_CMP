/**
 * Visual regression.
 *
 * The gap these close is narrow and real: a token renamed in `styles/`, a
 * utility class dropped in a refactor, a component that stops respecting dark
 * mode. None of that fails a type check, a lint or a behavioural test — the
 * button is still a button and still calls the right endpoint. It is just
 * invisible, or unreadable, or the wrong colour.
 *
 * Scope is deliberately small. Every screenshot is a file somebody has to
 * review on every change that touches it, so this covers the surfaces where a
 * regression would be *seen by somebody outside the organisation* — the sign-in
 * page and the public consent flow — plus the two states of the design system
 * itself. Screenshotting fifteen console list pages would produce a suite
 * people approve without looking, which is worse than not having one.
 *
 * ## Updating a baseline
 *
 *     npx playwright test --project=visual --update-snapshots
 *
 * Then look at the diff before committing it. A baseline updated without
 * looking is a test deleted.
 *
 * ## When one fails on a different machine
 *
 * Font rendering and anti-aliasing differ between platforms. `maxDiffPixelRatio`
 * in the config absorbs the noise; a failure above it is a real change. If a
 * baseline was captured on a different OS from CI's, regenerate it there rather
 * than raising the threshold.
 */
import { expect, test } from "@playwright/test";

/**
 * Serial, and for a measured reason rather than a cautious one.
 *
 * Run alone, these pass every time. Run with four parallel workers against a
 * dev server, the `rights` capture failed roughly one run in five — four
 * browsers competing for one Turbopack process delays a lazily-loaded chunk
 * past the settle check, and the screenshot catches the page one paint early.
 *
 * That is a measurement of the machine, not of the stylesheet. Raising the diff
 * threshold to absorb it would blind the suite to real changes; running these
 * one at a time removes the cause. Seven screenshots do not need to be
 * parallel.
 */
test.describe.configure({ mode: "serial" });

/**
 * Wait for the page to stop moving before capturing it.
 *
 * Each step here is a source of flake that was observed rather than guessed at.
 * The last one is the important one: `fullPage` measures the document at the
 * instant it fires, and a page still hydrating is still viewport-height. That
 * produced a `rights` baseline of 1280×1312 and captures of 1280×800 on
 * roughly two runs in three — a size mismatch, which reads as a total diff and
 * tells you nothing about what changed.
 */
async function settle(page: import("@playwright/test").Page) {
  await page.waitForLoadState("networkidle");

  // Web fonts swap in after first paint. Capturing before they land produces a
  // baseline in the fallback face and a diff on every subsequent run.
  await page.evaluate(() => document.fonts.ready);

  // Content is rendered by client components, so the document keeps growing
  // after `networkidle`. Wait until its height has been the same for two
  // consecutive frames.
  await page.waitForFunction(
    () =>
      new Promise<boolean>((resolve) => {
        const first = document.documentElement.scrollHeight;
        requestAnimationFrame(() =>
          requestAnimationFrame(() =>
            resolve(document.documentElement.scrollHeight === first && first > 0),
          ),
        );
      }),
    undefined,
    { timeout: 10_000 },
  );
}

test.describe("sign-in", () => {
  test("light", async ({ page }) => {
    await page.goto("/sign-in");
    await settle(page);
    await expect(page).toHaveScreenshot("sign-in-light.png", { fullPage: true });
  });

  test("dark", async ({ page }) => {
    // Set before navigating: the pre-paint theme script reads localStorage, and
    // setting it afterwards would capture a flash of the light palette.
    await page.addInitScript(() => localStorage.setItem("cmp-theme", "dark"));
    await page.goto("/sign-in");
    await settle(page);
    await expect(page).toHaveScreenshot("sign-in-dark.png", { fullPage: true });
  });

  test("the data-subject tab", async ({ page }) => {
    await page.goto("/sign-in");
    await page.getByRole("tab", { name: /data subject/i }).click();
    await settle(page);
    await expect(page.locator("main")).toHaveScreenshot("sign-in-subject-tab.png");
  });

  test("narrow", async ({ page }) => {
    // The brand panel is hidden below `lg`, and the layout it leaves behind is
    // a different composition rather than the same one squeezed.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/sign-in");
    await settle(page);
    await expect(page).toHaveScreenshot("sign-in-narrow.png", { fullPage: true });
  });
});

test.describe("public pages", () => {
  test("rights", async ({ page }) => {
    await page.goto("/rights");
    await settle(page);
    await expect(page).toHaveScreenshot("rights.png", { fullPage: true });
  });

  test("an invalid consent link", async ({ page }) => {
    // Worth pinning: this is what somebody sees when a link has expired, and
    // the whole design of the page is about being unhelpful in a kind way.
    await page.goto("/c/thisisnotarealtokenatall12345678");
    await settle(page);
    await expect(page.locator("main")).toHaveScreenshot("consent-link-invalid.png");
  });
});

test.describe("error states", () => {
  test("not found", async ({ page }) => {
    await page.goto("/no-such-page-exists");
    await settle(page);
    await expect(page.locator("body")).toHaveScreenshot("not-found.png");
  });
});
