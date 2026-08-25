/**
 * End-to-end: the session, and the boundaries around it.
 *
 * This file exists mostly for one bug, and it is worth stating plainly because
 * it cost a day and left no trace in either log.
 *
 * The API runs on `127.0.0.1:8000`. Somebody opens the console at
 * `localhost:3000`. Those are **different sites** to a browser, so the session
 * cookie — set `SameSite=Lax`, correctly — is dropped on the next XHR. Sign-in
 * returns 200. The request immediately after returns 401. The server log shows
 * a successful login followed by an unauthenticated request, and the browser
 * shows a sign-in page that just accepted the password.
 *
 * The `/api` rewrite in `next.config.ts` fixes it by making the API
 * same-origin, and it looks like an optimisation to anybody reading the config
 * without this context — which is exactly how it would get removed.
 *
 * So this spec runs in the `localhost-cookies` project as well as the default
 * one, and on that host it is the regression test for the rewrite. On
 * `127.0.0.1` the two names agree and it would pass either way.
 *
 * Credentials come from the environment; the tests skip without them rather
 * than fail, because a suite that goes red for a missing fixture trains people
 * to ignore red.
 */
import { expect, test, type Page } from "@playwright/test";

const LOGIN = process.env.E2E_STAFF_LOGIN;
const PASSWORD = process.env.E2E_STAFF_PASSWORD;

async function signIn(page: Page) {
  await page.goto("/sign-in");
  await page.getByLabel(/email or username/i).fill(LOGIN!);
  await page.getByLabel(/^password/i).fill(PASSWORD!);
  await page.getByRole("button", { name: /^sign in$/i }).click();
}

test.describe("security headers", () => {
  test("every response carries a Content Security Policy with a fresh nonce", async ({
    page,
  }) => {
    const first = await page.goto("/sign-in");
    const second = await page.goto("/rights");

    const policyOf = (r: NonNullable<Awaited<ReturnType<Page["goto"]>>>) =>
      r.headers()["content-security-policy"] ?? "";

    for (const response of [first!, second!]) {
      const policy = policyOf(response);
      expect(policy, "no CSP header").toBeTruthy();
      // 'strict-dynamic' is what makes the nonce worth having: a nonced script
      // may load further scripts (which is how Next's runtime works) and
      // nothing else is trusted.
      expect(policy).toContain("'strict-dynamic'");
      // Nothing may frame this application, and a `<base>` injection must not
      // be able to repoint every relative URL on the page.
      expect(policy).toContain("frame-ancestors 'none'");
      expect(policy).toContain("base-uri 'self'");
      // A form that posts anywhere but here is a credential-harvesting form.
      expect(policy).toContain("form-action 'self'");
    }

    const nonceOf = (policy: string) => policy.match(/'nonce-([a-f0-9]+)'/)?.[1];
    const a = nonceOf(policyOf(first!));
    const b = nonceOf(policyOf(second!));

    expect(a, "no nonce in the policy").toBeTruthy();
    // A nonce that repeats across requests is not a nonce — an attacker who
    // sees one page's source can reuse it.
    expect(a).not.toBe(b);
  });

  test("every inline script in the served HTML carries the nonce", async ({ page, request }) => {
    // Asserted against the *served markup*, not the live DOM, and the reason is
    // a browser behaviour that is easy to mistake for a bug: after parsing,
    // browsers blank the `nonce` content attribute and keep the value only on
    // the IDL property. That is deliberate - it stops an attacker recovering
    // the nonce with a CSS attribute selector like `script[nonce^="a"]`. So
    // `getAttribute("nonce")` returns "" on a perfectly nonced script, and a
    // test that reads it is testing the countermeasure rather than the policy.
    const response = await request.get("/sign-in");
    const html = await response.text();
    const nonce = (response.headers()["content-security-policy"] ?? "").match(
      /'nonce-([a-f0-9]+)'/,
    )?.[1];

    expect(nonce, "no nonce in the CSP header").toBeTruthy();

    const inline = [...html.matchAll(/<script(?![^>]*\ssrc=)([^>]*)>/g)].map((m) => m[1]);
    expect(inline.length, "expected at least the theme script").toBeGreaterThan(0);
    for (const attrs of inline) {
      expect(attrs, `an inline script has no nonce: <script${attrs}>`).toContain(
        `nonce="${nonce}"`,
      );
    }

    // And the policy is actually enforced.
    //
    // The probe has to be a **parser-inserted** script, which is what an
    // injection produces — a payload that lands in the markup and is parsed
    // with it. `document.createElement("script")` would be the obvious thing to
    // reach for and would prove nothing: `'strict-dynamic'` exists precisely to
    // allow scripts created by already-trusted code, so a created element runs
    // by design and a test asserting otherwise would be testing a
    // misunderstanding.
    //
    // The assertion is on whether the payload *ran*, not on a
    // `securitypolicyviolation` event: `document.write` after load replaces the
    // document, which takes any listener with it. Whether the script executed
    // is the question that matters anyway.
    await page.goto("/sign-in");
    const ran = await page.evaluate(async () => {
      document.write("<script>window.__cspBypassed = true;<\/script>");
      await new Promise((r) => setTimeout(r, 50));
      return "__cspBypassed" in window;
    });

    expect(
      ran,
      "a parser-inserted script without the nonce executed — the CSP is not enforcing",
    ).toBe(false);
  });

  test("does not advertise what it is running on", async ({ page }) => {
    const response = await page.goto("/sign-in");
    expect(response!.headers()["x-powered-by"]).toBeUndefined();
    expect(response!.headers()["x-frame-options"]).toBe("DENY");
    expect(response!.headers()["x-content-type-options"]).toBe("nosniff");
    expect(response!.headers()["referrer-policy"]).toBe("no-referrer");
  });
});

test.describe("route protection", () => {
  test("a signed-out visitor never receives a protected page", async ({ page }) => {
    // Not merely redirected after render: the page is never sent. A flash of a
    // project list is a disclosure however brief, and the API would have
    // refused the data anyway - this is about not shipping the shell.
    const response = await page.goto("/projects");

    await expect(page).toHaveURL(/\/sign-in/);
    // The redirect preserves where they were going, so signing in lands them
    // there rather than on a dashboard they then navigate away from.
    expect(page.url()).toContain("next=");
    expect(response!.url()).toContain("/sign-in");
  });

  test("public routes stay reachable with no session", async ({ page }) => {
    for (const path of ["/sign-in", "/rights", "/c/notarealtokenatall1234567890"]) {
      const response = await page.goto(path);
      expect(response!.status(), `${path} should not redirect`).toBeLessThan(400);
      await expect(page).toHaveURL(new RegExp(path.split("/")[1]));
    }
  });

  test("a forged `next` cannot send somebody off-origin after sign-in", async ({ page }) => {
    // The open redirect: a link that starts on this origin, shows this
    // organisation's sign-in page, and lands the user elsewhere with their
    // trust already established.
    await page.goto("/sign-in?next=https%3A%2F%2Fevil.example%2Fharvest");

    // The page renders normally - it does not follow the parameter on load -
    // and the parameter is not turned into a link anywhere.
    await expect(page.getByRole("heading", { name: /^sign in$/i })).toBeVisible();
    await expect(page.locator('a[href*="evil.example"]')).toHaveCount(0);
  });
});

test.describe("session cookie", () => {
  test.skip(!LOGIN || !PASSWORD, "set E2E_STAFF_LOGIN and E2E_STAFF_PASSWORD");

  test("survives the hop from sign-in to the first authenticated request", async ({
    page,
    context,
  }) => {
    // THE regression test. On `localhost` this fails the moment the /api
    // rewrite is removed, because the cookie is dropped between these two
    // steps and the dashboard's first call comes back 401.
    await signIn(page);

    await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 });
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    const cookies = await context.cookies();
    const session = cookies.find((c) => c.name === "cmp_session");

    expect(session, "no session cookie was set").toBeDefined();
    // HttpOnly is what stops an XSS from reading it. If this ever becomes
    // false, the session is one injected script away from being stolen.
    expect(session!.httpOnly).toBe(true);
    expect(session!.sameSite).toBe("Lax");
  });

  test("the CSRF cookie is readable, and the session one is not", async ({ page, context }) => {
    // The double-submit pattern needs exactly this asymmetry: the client reads
    // the CSRF token to echo it in a header, and cannot read the session.
    await signIn(page);
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 });

    const cookies = await context.cookies();
    expect(cookies.find((c) => c.name === "cmp_csrf")?.httpOnly).toBe(false);
    expect(cookies.find((c) => c.name === "cmp_session")?.httpOnly).toBe(true);

    // And the page can in fact read it — which is what the API client does.
    const csrfVisible = await page.evaluate(() => document.cookie.includes("cmp_csrf"));
    expect(csrfVisible).toBe(true);
  });

  test("signing out ends the session for real", async ({ page, context }) => {
    await signIn(page);
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 });

    // Sign out is a button in the sidebar, not an item behind an account menu.
    // Worth stating because the reverse is the more common pattern and this test
    // originally assumed it.
    await page.getByRole("button", { name: /^sign out$/i }).first().click();
    await expect(page).toHaveURL(/\/sign-in/, { timeout: 10_000 });

    // Not just cleared client-side: going back to a protected route has to
    // bounce, which it only does if the cookie is actually gone.
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/sign-in/);

    const cookies = await context.cookies();
    expect(cookies.find((c) => c.name === "cmp_session")?.value ?? "").toBe("");
  });

  test("lands on the page they were trying to reach", async ({ page }) => {
    await page.goto("/purposes");
    await expect(page).toHaveURL(/\/sign-in\?next=/);

    await page.getByLabel(/email or username/i).fill(LOGIN!);
    await page.getByLabel(/^password/i).fill(PASSWORD!);
    await page.getByRole("button", { name: /^sign in$/i }).click();

    await expect(page).toHaveURL(/\/purposes/, { timeout: 15_000 });
  });
});
