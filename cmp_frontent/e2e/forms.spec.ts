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

    // A nominated DCO is one of the three preconditions for creation, so the
    // select must be populated from /users?role=dco before this can pass.
    const dco = dialog.getByLabel(/data collection owner/i);
    await expect(dco.locator("option")).not.toHaveCount(1);
    await dco.selectOption({ index: 1 });

    await dialog.getByRole("button", { name: /register project/i }).click();

    await expect(dialog).not.toBeVisible({ timeout: 15_000 });
    // The list must show it without a reload: the mutation invalidates the query.
    await expect(page.getByText(`E2E Project ${STAMP}`)).toBeVisible({ timeout: 15_000 });
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
    await expect(dialog.getByRole("button", { name: /validate/i })).toBeVisible();
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

    await expect(page.getByRole("button", { name: /create link/i }).first()).toBeVisible({
      timeout: 15_000,
    });
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
