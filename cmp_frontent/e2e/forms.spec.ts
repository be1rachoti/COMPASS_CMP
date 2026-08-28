/**
 * The create/edit forms, driven for real.
 *
 * These write to the live database, so each one uses a unique code derived from
 * the clock — a fixture that collides with a previous run fails on a uniqueness
 * constraint and looks like a form bug.
 *
 * Serial, because they authenticate against a rate-limited API and several of
 * them depend on what the previous one created.
 */
import { expect, test } from "@playwright/test";

import { statePath } from "./support/session";

test.describe.configure({ mode: "serial" });

const STAMP = Date.now().toString().slice(-6);

test.describe("R&D User", () => {
  test.use({ storageState: statePath("rnd") });

  test("registers a project through the form", async ({ page }) => {
    await page.goto("/projects");

    await page.getByRole("button", { name: /register a project/i }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    await dialog.getByLabel(/project name/i).fill(`E2E Project ${STAMP}`);
    await dialog.getByLabel(/^description/i).fill("Created by the end-to-end suite.");

    // At least one processor is a precondition, so the list must be populated
    // from /processors before this can pass. Checked by name rather than by
    // index: which processors exist is seed data, and an index would pass while
    // silently choosing a different one.
    const aids = dialog.getByRole("checkbox", { name: /SEED/ });
    await expect(aids).toBeVisible();
    await aids.check();

    // The routing consequence is stated before the choice is committed, because
    // the same form produces a project that lands in somebody else's queue or
    // comes back to the author, and nothing else on screen says which.
    await expect(dialog.getByText(/DCO Admin assigns the data sources/i)).toBeVisible();

    await dialog.getByRole("button", { name: /register project/i }).click();

    await expect(dialog).not.toBeVisible({ timeout: 15_000 });
    // The list must show it without a reload: the mutation invalidates the query.
    await expect(page.getByText(`E2E Project ${STAMP}`)).toBeVisible({ timeout: 15_000 });
  });

  test("refuses a project with nobody named to collect", async ({ page }) => {
    // The field that replaced the DCO nomination. A project with no processor
    // cannot be routed at all, so it is refused at creation rather than
    // discovered to be un-routable after approval.
    await page.goto("/projects");
    await page.getByRole("button", { name: /register a project/i }).click();

    const dialog = page.getByRole("dialog");
    await dialog.getByLabel(/project name/i).fill(`No Collector ${STAMP}`);
    await dialog.getByLabel(/^description/i).fill("Nobody is named to collect this.");
    await dialog.getByRole("button", { name: /register project/i }).click();

    await expect(dialog.getByText(/choose at least one processor/i)).toBeVisible();
    await expect(dialog).toBeVisible();
  });

  test("refuses a project with no description", async ({ page }) => {
    await page.goto("/projects");
    await page.getByRole("button", { name: /register a project/i }).click();

    const dialog = page.getByRole("dialog");
    await dialog.getByLabel(/project name/i).fill("Incomplete");
    await dialog.getByRole("button", { name: /register project/i }).click();

    // The error belongs to the field, not to a banner that leaves the user
    // guessing which of five inputs was wrong.
    await expect(dialog.getByText(/describe what this project collects/i)).toBeVisible();
    await expect(dialog).toBeVisible();
  });
});

test.describe("DCO", () => {
  test.use({ storageState: statePath("dco") });

  test("opens the import wizard and gates submit on a dry run", async ({ page }) => {
    await page.goto("/imports");

    await page.getByRole("button", { name: /import a manifest/i }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    // Submit stays disabled until validation has passed. A manifest nobody has
    // checked is exactly the input that must not reach the database.
    await expect(dialog.getByRole("button", { name: /^import/i })).toBeDisabled();

    // And the check itself is not offered until it can actually run: the dry
    // run needs a source and a project, so the step says which is missing
    // rather than presenting a button that would fail.
    // Matched on the button's real words. "Check it — this writes nothing" is
    // what the control says, and a test that greps for "validate" passes or
    // fails on vocabulary the user never sees.
    const check = dialog.getByRole("button", { name: /check it/i });
    await expect(dialog.getByText(/choose a source and a project first/i)).toBeVisible();
    await expect(check).toHaveCount(0);

    await dialog.getByLabel(/data source/i).selectOption({ index: 1 });
    await dialog.getByLabel(/^project/i).selectOption({ index: 1 });

    // The step unlocks, and the check is still disabled until a file is chosen.
    await expect(check).toBeVisible();
    await expect(check).toBeDisabled();
    // Import stays shut either way: choosing where it came from is not checking it.
    await expect(dialog.getByRole("button", { name: /^import/i })).toBeDisabled();
  });

  test("offers a consent link only for an approved project", async ({ page }) => {

    // Filtered rather than picked off the first page. This test used to click
    // the seeded project directly, and passed until enough runs had created
    // enough projects to push it past the first page - at which point it failed
    // for a reason that had nothing to do with what it tests.
    await page.goto("/projects?q=Gait+Identification");

    const project = page.getByRole("link", { name: /gait identification/i }).first();
    await expect(project).toBeVisible({ timeout: 15_000 });
    await project.click();
    await page.waitForURL(/\/projects\//);

    // Either control, because which one appears depends on whether the site
    // already has a live link — "Create link" when it does not, "Replace link"
    // when it does. What this test is about is that an approved project offers
    // one at all; asserting the create wording made it fail the moment a link
    // existed, which is not a regression in anything.
    await expect(
      page.getByRole("button", { name: /^(create|replace) link$/i }).first(),
    ).toBeVisible({ timeout: 15_000 });
  });
});

test.describe("DCO cannot reach what the matrix denies", () => {
  test.use({ storageState: statePath("dco") });

  test("no provisioning control on a page they can read", async ({ page }) => {

    // /users is not in the DCO's nav at all - going straight there must not
    // render a create button even if the page itself loads.
    await page.goto("/processors");
    await expect(page.getByRole("button", { name: /register processor/i })).toHaveCount(0);
  });
});
