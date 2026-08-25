/**
 * Sign in once per role, and save the session for every spec to reuse.
 *
 * This exists because the suite was fighting a security control that is working
 * correctly. The API locks an account after five failed-or-otherwise login
 * attempts in thirty minutes, and four parallel workers each signing in as the
 * same DPO trip that within a single run. Every subsequent test then failed
 * with what looked like an application bug — a missing element, a redirect to
 * sign-in — and each of them passed when run alone, which is the most expensive
 * kind of flake to diagnose.
 *
 * Signing in once per role and reusing the cookie removes the cause. It is also
 * three or four seconds faster per test, which at forty tests is most of a
 * minute.
 *
 * **The session cookie is HttpOnly**, so it cannot be read and re-set by hand.
 * `storageState` captures it at the browser-context level, which is the only
 * mechanism that works for a cookie JavaScript is not allowed to see.
 *
 * Not covered here: `e2e/auth.spec.ts` deliberately signs in itself, because
 * the thing it tests *is* the sign-in.
 */
import { expect, test as setup, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

import { STATE_DIR, statePath } from "./support/session";

const PASSWORD = process.env.E2E_PASSWORD ?? "SeedPassw0rd!2026";

/**
 * Roles that sign in with a password alone.
 *
 * DPO and administrator require an MFA code that only exists in the dev outbox.
 * They are handled below, and skipped where the outbox is not readable.
 */
const PASSWORD_ONLY = [
  { role: "dco", login: "dco@cmp.local" },
  { role: "rnd", login: "rnd@cmp.local" },
];

const MFA_ROLES = [{ role: "dpo", login: "dpo@cmp.local" }];

/** The dev outbox the API writes one-time codes to. Absent in a real deployment. */
const OUTBOX = process.env.E2E_OUTBOX ?? path.join(__dirname, "..", "..", "cmp_backend", "outbox");

function latestCode(): string | null {
  try {
    const files = fs
      .readdirSync(OUTBOX)
      .map((f) => ({ f, t: fs.statSync(path.join(OUTBOX, f)).mtimeMs }))
      .sort((a, b) => b.t - a.t);
    for (const { f } of files.slice(0, 5)) {
      const body = fs.readFileSync(path.join(OUTBOX, f), "utf8");
      const match = body.match(/\b(\d{6})\b/);
      if (match) return match[1];
    }
  } catch {
    return null;
  }
  return null;
}

async function submitPassword(page: Page, login: string) {
  await page.goto("/sign-in");
  await page.getByLabel(/email or username/i).fill(login);
  await page.getByLabel(/^password/i).fill(PASSWORD);
  await page.getByRole("button", { name: /^sign in$/i }).click();
}

for (const { role, login } of PASSWORD_ONLY) {
  setup(`sign in as ${role}`, async ({ page, context }) => {
    await submitPassword(page, login);
    await page.waitForURL(/\/dashboard/, { timeout: 20_000 });

    // The shell renders after /auth/me resolves. Waiting for a nav link rather
    // than the URL is the difference between "signed in" and "the redirect
    // fired" — and a state file saved before the cookie settles is useless.
    await page.locator("#sidebar-nav a").first().waitFor({ state: "attached", timeout: 20_000 });

    fs.mkdirSync(STATE_DIR, { recursive: true });
    await context.storageState({ path: statePath(role) });
  });
}

for (const { role, login } of MFA_ROLES) {
  setup(`sign in as ${role}`, async ({ page, context }) => {
    await submitPassword(page, login);
    await page.waitForURL(/dashboard|verify/, { timeout: 20_000 });

    if (page.url().includes("verify")) {
      // The code is written after the response returns, so it may not be on
      // disk the instant this runs.
      await expect
        .poll(() => latestCode(), { timeout: 10_000, message: "no code in the dev outbox" })
        .not.toBeNull();

      await page.getByLabel(/digit code/i).fill(latestCode()!);
      await page.getByRole("button", { name: /verify and continue/i }).click();
      await page.waitForURL(/\/dashboard/, { timeout: 20_000 });
    }

    await page.locator("#sidebar-nav a").first().waitFor({ state: "attached", timeout: 20_000 });

    fs.mkdirSync(STATE_DIR, { recursive: true });
    await context.storageState({ path: statePath(role) });
  });
}
