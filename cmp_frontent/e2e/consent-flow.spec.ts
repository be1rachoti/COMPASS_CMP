/**
 * End-to-end: the public consent flow.
 *
 * These run in a real browser because the things being tested only exist in one:
 * the HttpOnly session cookie the client cannot read, the double-submit CSRF
 * header, and the multi-step state of the consent journey.
 *
 * They need a running API and a seeded consent link:
 *
 *   E2E_CONSENT_TOKEN=<token from scripts/seed.py> npx playwright test
 *
 * Without the token the link-dependent tests skip rather than fail — a suite
 * that goes red because a fixture is missing trains people to ignore red.
 */
import { expect, test } from "@playwright/test";

const TOKEN = process.env.E2E_CONSENT_TOKEN;

test.describe("invalid consent link", () => {
  // Same reason as the consent journey below: this hits the rate-limited public
  // surface, so it does not run alongside the tests that hammer it.
  test.describe.configure({ mode: "serial" });
  test("renders no notice content and does not say why", async ({ page }) => {
    await page.goto("/c/thisisnotarealtokenatall12345678");

    await expect(page.getByRole("heading", { name: /not valid/i })).toBeVisible();

    // Assert against the rendered main region, not `textContent("body")`: the
    // body also contains Next's RSC payload script, which mentions every route
    // in the app and makes a negative match meaningless.
    const main = page.locator("main");

    // The reason is deliberately *not* narrowed down. The page offers every
    // possibility at once - expired, withdrawn, mistyped - which helps a
    // legitimate visitor without telling a token-guesser which of their guesses
    // was structurally valid. Naming one would be the disclosure.
    await expect(main).toContainText(/expired.*withdrawn.*mistyped/is);

    // What it must never do is state a definite cause.
    await expect(main).not.toContainText(/has expired|was revoked|no such link/i);

    // And nothing from a real notice leaks onto the page.
    await expect(main).not.toContainText(/retention|data categories|purpose/i);
  });
});

test.describe("consent journey", () => {
  test.skip(!TOKEN, "set E2E_CONSENT_TOKEN to a seeded link token");

  // Serial, and deliberately so. The public consent surface is rate limited per
  // address (60/min on the link, 5/hour per contact for codes), and parallel
  // workers share one address from the API's point of view. Running these
  // concurrently makes them contend with a control that is working correctly,
  // which produces failures that look like application bugs and are not.
  test.describe.configure({ mode: "serial" });

  test("walks registration through to the notice", async ({ page }) => {
    await page.goto(`/c/${TOKEN}`);

    // Step 1: the link resolves and names the project and site.
    await expect(page.getByText(/your details/i).first()).toBeVisible();

    const email = `e2e.${Date.now()}@example.org`;
    await page.getByLabel(/full name/i).fill("E2E Test Subject");
    await page.getByLabel(/^email/i).fill(email);
    await page.getByRole("button", { name: /continue/i }).click();

    // Step 2: a confirmation code is requested. We cannot read the mailbox from
    // here, so the assertion is that the flow advanced and is asking for one.
    await expect(page.getByText(/confirm your email/i)).toBeVisible();
    await expect(page.getByLabel(/six-digit code/i)).toBeVisible();
  });

  test("a wrong code is refused without advancing", async ({ page }) => {
    await page.goto(`/c/${TOKEN}`);

    const email = `e2e.${Date.now()}@example.org`;
    await page.getByLabel(/full name/i).fill("E2E Test Subject");
    await page.getByLabel(/^email/i).fill(email);
    await page.getByRole("button", { name: /continue/i }).click();

    await page.getByLabel(/six-digit code/i).fill("000000");
    await page.getByRole("button", { name: /confirm and read/i }).click();

    // Scoped to main: Next appends its own role="alert" route announcer to the
    // body, so an unscoped getByRole("alert") matches two elements and fails
    // strict mode for a reason that has nothing to do with the app.
    await expect(page.locator("main").getByRole("alert")).toContainText(
      /invalid or expired/i,
    );
    // Still on the verification step: a rejected code must not let anyone past.
    await expect(page.getByLabel(/six-digit code/i)).toBeVisible();
  });
});

test.describe("sign-in", () => {
  test("offers both populations a route in", async ({ page }) => {
    await page.goto("/sign-in");

    // The h1 names the task, not the product. The product name is a lockup
    // beside it - making it the heading would leave the page's only h1 saying
    // nothing about what the page is for.
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(/sign in/i);
    // Two lockups exist - the brand panel's and the compact one - and which is
    // visible depends on the viewport. Filtering on visibility asserts "the user
    // can see the product name here" rather than which breakpoint drew it.
    await expect(
      page.getByText(/consent management platform/i).filter({ visible: true }).first(),
    ).toBeVisible();

    await expect(page.getByRole("tab", { name: /staff/i })).toBeVisible();
    await expect(page.getByRole("tab", { name: /data subject/i })).toBeVisible();

    // A data subject has no password - `password_hash` is nullable for exactly
    // that reason - so their tab must not ask for one.
    await page.getByRole("tab", { name: /data subject/i }).click();
    await expect(page.locator('input[type="password"]')).toHaveCount(0);
  });

  test("does not reveal whether an account exists", async ({ page }) => {
    await page.goto("/sign-in");
    await expect(page.getByLabel(/email or username/i)).toBeVisible();

    await page.getByLabel(/email or username/i).fill("definitely-not-a-user@example.org");
    await page.getByLabel(/^password/i).fill("wrong-password-entirely");
    await page.getByRole("button", { name: /^sign in$/i }).click();

    // Scoped for the same reason as above - Next's route announcer also carries
    // role="alert".
    const alert = page.locator("main").getByRole("alert").first();
    await expect(alert).toBeVisible();
    // One sentence for every failure mode. Anything more specific turns the form
    // into an account-enumeration oracle.
    await expect(alert).not.toContainText(/no such|not found|does not exist|unknown user/i);
  });
});

test.describe("rights page", () => {
  test("is public and states the Board route alongside ours", async ({ page }) => {
    await page.goto("/rights");

    await expect(page.getByRole("heading", { name: /your rights/i })).toBeVisible();

    // The content arrives from the API after first paint, so these must be
    // auto-retrying locator assertions rather than a one-shot text snapshot.
    const main = page.locator("main");

    // Rule 9 / Rule 14(1): telling someone only about the internal grievance
    // process misstates the remedy available to them.
    await expect(main).toContainText(/Data Protection Board/i, { timeout: 10_000 });
    await expect(main).toContainText(/withdraw/i);
    await expect(main).toContainText(/erasure|correction/i);
  });
});

test.describe("access control", () => {
  test("an unauthenticated visitor is sent to sign-in, not shown the page", async ({
    page,
  }) => {
    await page.goto("/projects");
    await page.waitForURL(/\/sign-in/);

    // The page must never flash its contents before redirecting - a flash of a
    // project list is a disclosure, however brief.
    await expect(page.locator("main")).not.toContainText(/Data Collection Owner/i);
  });

  test("the return path is preserved", async ({ page }) => {
    await page.goto("/projects");
    // The redirect carries the intended destination so the user lands where they
    // were going, not on a generic dashboard.
    await page.waitForURL(/\/sign-in\?next=/);
  });
});

test.describe("accessibility basics", () => {
  test("every page starts with a skip link and a single h1", async ({ page }) => {
    for (const path of ["/sign-in", "/rights"]) {
      await page.goto(path);

      const skip = page.getByRole("link", { name: /skip to content/i });
      await expect(skip).toBeAttached();

      // Exactly one h1: a page with none is unnavigable by heading, and a page
      // with several has no single answer to "what is this page".
      await expect(page.locator("h1")).toHaveCount(1);
    }
  });

  test("the consent form is reachable by keyboard alone", async ({ page }) => {
    await page.goto("/sign-in");

    // Skip link, then the first tab, then into the form.
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");

    const focused = await page.evaluate(() => document.activeElement?.tagName);
    expect(["INPUT", "BUTTON", "A"]).toContain(focused);
  });
});
