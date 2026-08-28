/**
 * Reaching the notice upload as the person who has to use it.
 *
 * This exists because the control was built, wired and tested at every layer
 * below the screen — the endpoints worked, the parser worked, the dialog
 * worked — and an R&D User still could not find it. The page header carried the
 * button among several others, while the card that said "No notice yet" offered
 * nothing to click. Every unit test passed the whole time.
 *
 * So the assertion here is deliberately about *reachability from the empty
 * state*, not about whether the button exists somewhere on the page. A control
 * that exists but that nobody looking for it will find is not a control.
 */
import { expect, test } from "@playwright/test";

import { statePath } from "./support/session";

test.describe.configure({ mode: "serial" });

test.describe("R&D User", () => {
  test.use({ storageState: statePath("rnd") });

  test("can reach the notice upload from a draft project's notices card", async ({ page }) => {
    await page.goto("/projects?status=in_draft");

    // Selected by where the link goes, not by its text. Matching on a name like
    // /Project/ also matches the sidebar entry and the breadcrumb, and clicking
    // one of those lands on the list again — which then fails further down for
    // a reason that has nothing to do with what is under test.
    const firstProject = page.locator('a[href^="/projects/"]').first();
    await expect(firstProject).toBeVisible({ timeout: 15_000 });
    await firstProject.click();

    await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}/, { timeout: 15_000 });

    const noticesCard = page.locator("section, div").filter({
      has: page.getByRole("heading", { name: /^notices$/i }),
    });
    await expect(page.getByRole("heading", { name: /^notices$/i })).toBeVisible({
      timeout: 15_000,
    });

    // From the card, not the page header. The header carries one too, and this
    // test is about the other one — the control on the card that says there is
    // no notice yet, which is where somebody looking for it actually looks.
    const fromCard = noticesCard
      .getByRole("button", { name: /upload a notice document/i })
      .last();
    await expect(fromCard).toBeVisible({ timeout: 15_000 });
    await fromCard.click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(/need the template/i)).toBeVisible();

    // The check cannot run before a file is chosen, and the import cannot run
    // before the check — the ordering is the point of the two-step flow.
    await expect(dialog.getByRole("button", { name: /check the document/i })).toBeDisabled();
    await expect(dialog.getByRole("button", { name: /create the notice/i })).toBeDisabled();
  });
});
