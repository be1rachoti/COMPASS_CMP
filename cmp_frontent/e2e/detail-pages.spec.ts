/**
 * The detail pages behind every list.
 *
 * These exist because the list pages linked to routes that did not exist, and a
 * 404 reached from a link the product itself renders is the kind of gap that
 * only a click finds. Each test follows the real link rather than constructing
 * a URL, so the link and the route are tested together.
 *
 * A role that cannot see a list is skipped rather than failed: the permission
 * matrix is the backend's answer, and asserting a fixed list here would be a
 * second copy of it.
 */
import { test, expect, type Page } from "@playwright/test";

import { statePath } from "./support/session";

/**
 * Signed in as the DPO, once, by the setup project.
 *
 * Not per test: the API locks an account after five login attempts in thirty
 * minutes, and a file of tests each signing in trips that inside one run.
 */
test.use({ storageState: statePath("dpo") });

/**
 * Follow the first link in a list's table and assert the destination rendered.
 *
 * `notFoundText` is the thing Next renders for a missing route; asserting its
 * absence is what makes this a regression test for the 404 rather than a smoke
 * test for the layout.
 */
async function followFirstRow(page: Page, listPath: string, hrefPrefix: string) {
  await page.goto(listPath);

  // The table paints only once the query resolves, so waiting for the link is
  // the difference between "this list is empty" and "the fetch is in flight".
  const link = page.locator(`table a[href^="${hrefPrefix}"]`).first();
  await Promise.race([
    link.waitFor({ state: "visible", timeout: 15_000 }).catch(() => undefined),
    page.getByText(/^No |Nothing /).first().waitFor({ timeout: 15_000 }).catch(() => undefined),
  ]);

  if ((await link.count()) === 0) {
    test.skip(true, `no rows in ${listPath} to open`);
  }

  const href = await link.getAttribute("href");
  await link.click();
  await page.waitForURL(new RegExp(hrefPrefix.replace(/\//g, "\\/")), { timeout: 15_000 });

  await expect(page.getByText("This page could not be found")).toHaveCount(0);
  await expect(page.locator("h1")).toBeVisible();
  return href;
}

test.describe("detail pages resolve", () => {
  test("a consent record opens from the register", async ({ page }) => {
    await followFirstRow(page, "/consents", "/consents/");

    // The evidence trio is the reason this page exists.
    await expect(page.getByText("Served at")).toBeVisible();
    await expect(page.getByText("Acted at")).toBeVisible();
    await expect(page.getByText("Content hash")).toBeVisible();

    // Purposes are listed one by one, never summarised as a count. Asserting a
    // real row rather than the heading is what catches a card that renders its
    // skeleton forever because the endpoint is failing behind it.
    await expect(page.getByText(/^(Agreed|Not agreed)$/).first()).toBeVisible();
    await expect(page.getByText("Lawful basis:").first()).toBeVisible();

    // The internal surrogate key must not be on the wire.
    const body = await page.content();
    expect(body).not.toContain('"consent_id"');
  });

  test("a purpose opens from the register", async ({ page }) => {
    await followFirstRow(page, "/purposes", "/purposes/");
    await expect(page.getByRole("heading", { name: "What was promised" })).toBeVisible();
    await expect(page.getByText("Lawful basis")).toBeVisible();
  });

  test("a collection opens from the register", async ({ page }) => {
    await followFirstRow(page, "/collections", "/collections/");
    await expect(page.getByRole("heading", { name: "Reconciliation" })).toBeVisible();
    await expect(page.getByText("Declared", { exact: true })).toBeVisible();
  });

  test("an import batch opens from the register", async ({ page }) => {
    await followFirstRow(page, "/imports", "/imports/");
    await expect(page.getByRole("heading", { name: "Outcome" })).toBeVisible();
    await expect(page.getByText("SHA-256")).toBeVisible();
  });
});
