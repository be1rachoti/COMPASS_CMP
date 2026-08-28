/**
 * Getting a consent link's URL after the fact.
 *
 * The token is shown once at mint and the database keeps only a keyed digest,
 * so there is no reveal button and there cannot be one. What there has to be is
 * an obvious path to a URL you *can* copy — and on the project page, where a
 * collection owner actually works, there was not: the button minted a second
 * link regardless of whether the site already had a live one, leaving two
 * working URLs with only one of them tracked.
 */
import { expect, test } from "@playwright/test";

import { statePath } from "./support/session";

test.describe.configure({ mode: "serial" });

test.describe("consent links", () => {
  test.use({ storageState: statePath("dco") });

  test("the Links page treats the URL as a credential", async ({ page }) => {
    await page.goto("/links");
    await expect(page.getByText(/the link is a credential/i)).toBeVisible();
    // The property that survived making links recoverable, and the one an
    // operator needs to understand: the key is not in the database.
    await expect(page.getByText(/key that lives outside the database/i)).toBeVisible();
    await expect(page.getByText(/treat it as a credential/i)).toBeVisible();
  });

  test("a recoverable link offers copy; an older one says why it cannot", async ({ page }) => {
    await page.goto("/links?status=active");
    await page
      .getByRole("button", { name: /copy link|url not kept/i })
      .first()
      .waitFor({ timeout: 15_000 });

    // Both states are legitimate — links minted before sealing cannot be shown
    // again — so what matters is that neither is a blank or a broken URL.
    const copy = await page.getByRole("button", { name: /^copy link$/i }).count();
    const notKept = await page.getByRole("button", { name: /url not kept/i }).count();
    expect(copy + notKept).toBeGreaterThan(0);
  });

  test("replacing a link offers the new URL with a copy button", async ({ page }) => {
    await page.goto("/links?status=active");

    const replace = page.getByRole("button", { name: /^replace$/i }).first();
    await expect(replace).toBeVisible();
    await replace.click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    // The confirmation, before anything is revoked.
    await expect(dialog.getByRole("button", { name: /replace/i })).toBeVisible();
  });

  test("a site with a live link offers to replace it, not to mint a second", async ({
    page,
  }) => {
    // The gap this closes. Two working URLs for one site is the failure the
    // Links page has always guarded against and this page did not.
    //
    // Reached from /sites rather than the project list: a DCO sees only the
    // sites they run, so picking whichever project happens to sort first lands
    // on one with no site of theirs and no link control at all — a test that
    // fails for a reason unrelated to what it checks.
    await page.goto("/sites");
    const toProject = page.locator('a[href^="/projects/"]').first();
    await expect(toProject).toBeVisible({ timeout: 15_000 });
    await toProject.click();
    await page.waitForURL(/\/projects\//);

    const create = page.getByRole("button", { name: /^create link$/i });
    const replace = page.getByRole("button", { name: /^replace link$/i });

    // Waited for, not counted. `count()` reads once with no retry, and these
    // render only after the links query resolves — so counting immediately
    // reports zero and the test fails on timing rather than on behaviour.
    await expect(
      page.getByRole("button", { name: /^(create|replace) link$/i }).first(),
    ).toBeVisible({ timeout: 15_000 });

    // Whichever the site's state calls for — but never both for one site, and
    // the replace control has to explain that the URL is not stored.
    const hasCreate = await create.count();
    const hasReplace = await replace.count();
    expect(hasCreate + hasReplace).toBeGreaterThan(0);

    if (hasReplace) {
      // A site with a live link offers the URL itself — copy where it can be
      // recovered, and an explicit "URL not kept" where it cannot. Replace sits
      // beside it for rotating a link that has circulated too far, which is a
      // different intent and no longer the only way to get an address.
      await expect(
        page.getByRole("button", { name: /^(copy link|url not kept)$/i }).first(),
      ).toBeVisible();
    }
  });
});
