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
import { expect, test as setup, type Browser, type Page } from "@playwright/test";
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
  { role: "dcoadmin", login: "dcoadmin@cmp.local" },
  { role: "rco", login: "rco@cmp.local" },
];

const MFA_ROLES = [{ role: "dpo", login: "dpo@cmp.local" }];

/**
 * The data principal, who has no password at all.
 *
 * `password_hash` is nullable for exactly this reason: she never chose one and
 * was never given one. She signs in with a one-time code from a different form
 * on the same page, so her session cannot be produced by the helpers above -
 * and until this existed the suite had no way to drive her console at all.
 */
const SUBJECT = { role: "subject", contact: "subject@cmp.local" };

/**
 * The dev outbox the API writes one-time codes to.
 *
 * A single append-only *file*, not a directory of messages — the console
 * transport writes one log. Getting that wrong is what produced the original
 * failure: `readdirSync` on a file throws ENOTDIR, the catch swallowed it, and
 * the message said "no code in the dev outbox", which was true and useless.
 *
 * Only exists in a local deployment; a real one sends mail. Absence is why the
 * MFA roles skip rather than fail.
 */
const OUTBOX =
  process.env.E2E_OUTBOX ??
  path.join(__dirname, "..", "..", "cmp_backend", "var", "outbox.log");

/** Why no code was found. Kept so the failure message can say something. */
let outboxProblem = "not read yet";

/**
 * The newest code the outbox holds **for one recipient**.
 *
 * Recipient-aware because the outbox is a single append-only log and the setup
 * projects run in parallel: reading "the newest six-digit number" hands the
 * data principal the DPO's code, which the server then rejects as invalid. The
 * failure reads like a broken sign-in and is nothing of the sort.
 *
 * Walks forward rather than backwards, because the `to:` header precedes the
 * code in each block, so the recipient is only known once it has been seen.
 */
function latestCodeFor(recipient: string): string | null {
  try {
    const lines = fs.readFileSync(OUTBOX, "utf8").split(/\r?\n/);
    let current: string | null = null;
    let found: string | null = null;

    for (const line of lines) {
      const to = /\bto:\s*(\S+)/.exec(line);
      if (to) {
        current = to[1];
        continue;
      }
      // Two wordings for two flows: staff get a "verification code", a data
      // principal a "sign-in code". Matching only one of them made her sign-in
      // look broken when it was the reader that was too narrow.
      const code = /code is (\d{6})/.exec(line);
      if (code && current?.toLowerCase() === recipient.toLowerCase()) found = code[1];
    }

    if (!found) {
      outboxProblem = `read ${OUTBOX} (${lines.length} lines), no code addressed to ${recipient}`;
    }
    return found;
  } catch (error) {
    outboxProblem = `could not read ${OUTBOX}: ${(error as Error).message}`;
    return null;
  }
}

/**
 * Prefer a newly-arrived code; settle for the one already there.
 *
 * Two failure modes pull in opposite directions, and both were hit here.
 *
 * Reading "the latest code" succeeds instantly against a previous run's, which
 * the server rejects as expired — so newness has to be waited for.
 *
 * But the API allows only a handful of codes per contact per hour, and that is
 * a control working correctly rather than something the suite should disable.
 * Once it bites, no new code is written and waiting for one never succeeds.
 *
 * So: wait for a new one, and if none comes, use the newest that exists. It has
 * a ten-minute life, so it is very often still good — and if it is not, the
 * verify step fails with the server's own message rather than a timeout that
 * says nothing.
 */
async function freshCode(recipient: string, previous: string | null): Promise<string> {
  await expect
    .poll(() => latestCodeFor(recipient), { timeout: 15_000 })
    .not.toBe(previous)
    .catch(() => {
      /* Rate-limited, most likely. Fall through to whatever is there. */
    });

  const code = latestCodeFor(recipient);
  if (!code) throw new Error(`no one-time code for ${recipient}: ${outboxProblem}`);
  return code;
}


/**
 * Is a saved session still good?
 *
 * The data principal signs in with a one-time code, and the API allows only a
 * handful per contact per hour — a control that is working, and one the suite
 * should live within rather than switch off. Signing her in on every run spends
 * that budget on nothing: her session outlives a single run, so the cheapest
 * correct thing is to check the one already on disk before asking for another.
 *
 * Only she needs this. The staff roles sign in with a password, which has no
 * such budget, and re-authenticating them each run keeps the setup honest about
 * whether sign-in still works.
 */
async function sessionStillWorks(browser: Browser, role: string): Promise<boolean> {
  if (!fs.existsSync(statePath(role))) return false;
  const context = await browser.newContext({
    storageState: statePath(role),
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
  });
  try {
    const page = await context.newPage();
    await page.goto("/my-consents");
    // Wait for the app to settle before reading the URL. The redirect to
    // sign-in is client-side, fired once `/auth/me` resolves, so checking at
    // `domcontentloaded` reports a dead session as a live one - and the run
    // then fails several tests later, somewhere unrelated.
    await page.waitForLoadState("networkidle").catch(() => {});
    return !page.url().includes("sign-in");
  } catch {
    return false;
  } finally {
    await context.close();
  }
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
    const before = latestCodeFor(login);
    await submitPassword(page, login);
    await page.waitForURL(/dashboard|verify/, { timeout: 20_000 });

    if (page.url().includes("verify")) {
      // The code is written after the response returns, so it may not be on
      // disk the instant this runs, and the one already there is a previous
      // run's, which the server will reject.
      await page.getByLabel(/digit code/i).fill(await freshCode(login, before));
      await page.getByRole("button", { name: /verify and continue/i }).click();
      await page.waitForURL(/\/dashboard/, { timeout: 20_000 });
    }

    await page.locator("#sidebar-nav a").first().waitFor({ state: "attached", timeout: 20_000 });

    fs.mkdirSync(STATE_DIR, { recursive: true });
    await context.storageState({ path: statePath(role) });
  });
}

setup(`sign in as ${SUBJECT.role}`, async ({ page, context, browser }) => {
  // Reuse before spending a one-time code. See `sessionStillWorks`.
  if (await sessionStillWorks(browser, SUBJECT.role)) return;

  const before = latestCodeFor(SUBJECT.contact);

  await page.goto("/sign-in");
  await page.getByRole("tab", { name: /data subject/i }).click();
  await page.getByLabel(/email or mobile/i).fill(SUBJECT.contact);
  await page.getByRole("button", { name: /send.*code|continue/i }).click();

  await page.getByLabel(/six-digit code/i).fill(await freshCode(SUBJECT.contact, before));
  await page.getByRole("button", { name: /^verify$/i }).click();

  // Her console has no staff sidebar to wait on, so wait for the page itself.
  await page.waitForURL(/\/(dashboard|my-consents)/, { timeout: 20_000 });

  fs.mkdirSync(STATE_DIR, { recursive: true });
  await context.storageState({ path: statePath(SUBJECT.role) });
});
