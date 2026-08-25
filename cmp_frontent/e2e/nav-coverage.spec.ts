/**
 * Every nav destination must load, for every role.
 *
 * This is the test that would have caught the original problem: the sidebar was
 * rendered from `me.nav`, but most of those destinations had no page behind them,
 * so the product shipped a menu of 404s. Asserting "the link exists" would not
 * have caught it either - the link existed. The assertion has to be that
 * following it produces a page.
 *
 * Runs serially: these are authenticated sessions against a rate-limited API.
 */
import { expect, test } from "@playwright/test";

import { statePath } from "./support/session";

test.describe.configure({ mode: "serial" });

/** Roles that sign in with one step. DPO and admin need an MFA code that only
 *  exists in the dev outbox, so they are covered by the backend tests instead. */
const ROLES = [
  {
    role: "dco",
    name: "DCO",
    expected: [
      "/dashboard",
      "/projects",
      "/sites",
      "/links",
      "/consents",
      "/exports",
      "/imports",
      "/collections",
    ],
  },
  {
    role: "rnd",
    name: "R&D User",
    expected: ["/dashboard", "/projects", "/approvals", "/imports", "/collections"],
  },
];

for (const role of ROLES) {
  test.describe(`${role.name}`, () => {
    // Each role's session is saved once by the setup project. Signing in here
    // would put four workers through the login endpoint as the same account and
    // trip the lockout.
    test.use({ storageState: statePath(role.role) });

    test("every sidebar link reaches a real page", async ({ page }) => {
      await page.goto("/dashboard");
      await page
        .locator("#sidebar-nav a")
        .first()
        .waitFor({ state: "attached", timeout: 15_000 });

      // Take the destinations from the rendered sidebar, not from a hardcoded
      // list: the sidebar is built from what the *server* says this role has, so
      // this asserts against the real contract rather than our assumption of it.
      const hrefs = await page
        .locator("#sidebar-nav a")
        .evaluateAll((links) =>
          links.map((a) => (a as HTMLAnchorElement).getAttribute("href")).filter(Boolean),
        );

      expect(hrefs.length, "the sidebar rendered no links").toBeGreaterThan(0);

      for (const href of hrefs) {
        const failures: string[] = [];
        page.on("response", (r) => {
          if (r.status() >= 500) failures.push(`${r.status()} ${r.url()}`);
        });

        await page.goto(href!);

        // Not a 404 shell, and not an empty body.
        await expect(
          page.getByText(/this page could not be found/i),
          `${href} rendered Next's 404`,
        ).toHaveCount(0);

        // The page heading proves a real page rendered, not a blank route.
        await expect(page.locator("h1"), `${href} has no heading`).toHaveCount(1);

        expect(failures, `${href} produced a server error`).toEqual([]);
        page.removeAllListeners("response");
      }
    });

    test("the expected sections are present", async ({ page }) => {
      await page.goto("/dashboard");
      await page
        .locator("#sidebar-nav a")
        .first()
        .waitFor({ state: "attached", timeout: 15_000 });

      const hrefs = await page
        .locator("#sidebar-nav a")
        .evaluateAll((links) =>
          links.map((a) => (a as HTMLAnchorElement).getAttribute("href")),
        );

      for (const expected of role.expected) {
        expect(hrefs, `${role.name} is missing ${expected}`).toContain(expected);
      }
    });

    test("no section this role may not use is offered", async ({ page }) => {
      await page.goto("/dashboard");
      await page
        .locator("#sidebar-nav a")
        .first()
        .waitFor({ state: "attached", timeout: 15_000 });

      const hrefs = await page
        .locator("#sidebar-nav a")
        .evaluateAll((links) =>
          links.map((a) => (a as HTMLAnchorElement).getAttribute("href")),
        );

      // The register of accounts and the audit trail are for the DPO and the
      // administrator. Offering them here would be a link that 403s on click.
      expect(hrefs).not.toContain("/users");
      expect(hrefs).not.toContain("/audit");
    });
  });
}
