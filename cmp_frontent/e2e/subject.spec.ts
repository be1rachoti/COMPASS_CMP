/**
 * A data principal stays on her own side of the product.
 *
 * Reported: opening Notifications as a data subject led to an admin screen. The
 * feed itself was correct — her own events and nothing else — but every row
 * carried a link resolved for staff, and her registration event resolved to
 * `/users`, the administrator's account register.
 *
 * Two things are tested because there were two faults: the link is no longer
 * offered, and the page no longer renders if something else produces the URL.
 */
import { expect, test } from "@playwright/test";

import { statePath } from "./support/session";

test.describe.configure({ mode: "serial" });

test.describe("data subject", () => {
  test.use({ storageState: statePath("subject") });

  test("her notifications link to her own pages, never a console", async ({ page }) => {
    await page.goto("/notifications");
    await expect(page.getByRole("heading", { name: /notifications/i }).first()).toBeVisible();

    // Every link on the page has to be somewhere she can go. Asserted over all
    // of them rather than the first: the bug was one entity type among several.
    const hrefs = await page.locator("main a[href^='/']").evaluateAll((links) =>
      links.map((l) => l.getAttribute("href") ?? ""),
    );
    const staffOnly = hrefs.filter((h) =>
      /^\/(users|consents|notices|projects|audit|sources|processors|sites|links|exports|imports|collections|approvals|purposes)(\/|$)/.test(
        h,
      ),
    );
    expect(staffOnly, `staff routes offered to a data subject: ${staffOnly}`).toEqual([]);
  });

  test("a staff URL does not render its screen", async ({ page }) => {
    // The second half. Whatever produced the URL — an old link, a bookmark, a
    // notification from before the fix — the account register is not her page.
    await page.goto("/users");

    await expect(page.getByText(/not part of your account/i)).toBeVisible();
    // And specifically not the thing it guards.
    await expect(page.getByRole("button", { name: /create account|provision/i })).toHaveCount(0);
  });

  test("her own sections still work", async ({ page }) => {
    // The guard must not have locked her out of her own product.
    for (const path of ["/my-consents", "/profile", "/notifications"]) {
      await page.goto(path);
      await expect(page.getByText(/not part of your account/i)).toHaveCount(0);
    }
  });
});
