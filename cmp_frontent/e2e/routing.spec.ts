/**
 * Routing an approved project, driven through the screens.
 *
 * The API tests prove the rules. What they cannot prove is that somebody can
 * *reach* them: the DCO Admin's whole job is two screens — make somebody
 * accountable for a source, then attach that source to a site — and either one
 * being unreachable leaves an approved project stalled with nothing on screen
 * saying why.
 *
 * Serial, because these authenticate against a rate-limited API and the second
 * half depends on what the first half set up.
 */
import { expect, test } from "@playwright/test";

import { statePath } from "./support/session";

test.describe.configure({ mode: "serial" });

test.describe("DCO Admin", () => {
  test.use({ storageState: statePath("dcoadmin") });

  test("can see the sources registry and who is accountable for each", async ({ page }) => {
    await page.goto("/sources");

    // The column that did not exist before ownership moved onto the source.
    // Without it the registry lists rigs and says nothing about who answers for
    // them, which is the one question the routing turns on.
    await expect(page.getByRole("columnheader", { name: /accountable/i })).toBeVisible();
    await expect(page.getByRole("cell", { name: /CIT/ }).first()).toBeVisible();
  });

  test("arrives from the dashboard count with the filter already applied", async ({ page }) => {
    // A count is a claim about a subset. Landing on the unfiltered registry
    // makes the reader find those rows themselves, which is the difference
    // between a number that is a link and a number that is a lead.
    await page.goto("/sources?unowned=1");
    await expect(page.getByRole("checkbox", { name: /nobody accountable/i })).toBeChecked();
  });

  test("names the roles a source can be handed to, and refuses the wrong one", async ({ page }) => {
    await page.goto("/sources");

    // CIT sits under SEED, which is collected by a third party — so the dialog
    // asks for a DCO. Offering an RCO here would record in-house staff as
    // answerable for work they are not doing, and the API refuses it; the form
    // should not present the option in the first place.
    const row = page.getByRole("row").filter({ hasText: "SRC-SEED-CIT" });
    await row.getByRole("button", { name: /assign|reassign/i }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(/collection from this source is by a third party/i)).toBeVisible();

    // Asserted with locators rather than by reading the options into an array:
    // the list arrives from a query, and `allInnerTexts()` resolves once against
    // whatever is there at that instant. Expectations on a locator retry.
    const select = dialog.getByLabel(/data collection owner/i);
    await expect(select.locator("option").filter({ hasText: "Arun Shetty" })).toHaveCount(1);
    // Meera Iyer is the seeded RCO. Her absence is the assertion.
    await expect(select.locator("option").filter({ hasText: "Meera Iyer" })).toHaveCount(0);
  });

  test("an in-house source asks for an RCO instead", async ({ page }) => {
    await page.goto("/sources");

    const row = page.getByRole("row").filter({ hasText: "SRC-SRIB-SE" });
    await row.getByRole("button", { name: /assign|reassign/i }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText(/collection from this source is in-house/i)).toBeVisible();

    const select = dialog.getByLabel(/r&d collection owner/i);
    await expect(select.locator("option").filter({ hasText: "Meera Iyer" })).toHaveCount(1);
    await expect(select.locator("option").filter({ hasText: "Arun Shetty" })).toHaveCount(0);
  });
});

test.describe("DCO Admin on an approved project", () => {
  test.use({ storageState: statePath("dcoadmin") });

  test("can register a collection site", async ({ page }) => {
    // Reported: the DCO Admin had no way to add one. The API allowed it and the
    // button did not, so the role's whole job was unreachable from the project
    // it had to be done on.
    await page.goto("/projects?status=approved");
    await page.getByRole("link", { name: /./ }).first().waitFor();

    const firstProject = page.locator("table a").first();
    await firstProject.click();

    await expect(page.getByRole("button", { name: /add site/i })).toBeVisible();
  });

  test("a collection site is chosen from the registry, not typed", async ({ page }) => {
    // A site is one data source deployed on one project. Typing a label, a
    // processor and a source separately asked the same question three times and
    // let the answers disagree — a site called "Pune lab", operated by one
    // processor, fed by another's rig, is three claims and at most one is right.
    await page.goto("/projects?status=approved");
    await page.locator("table a").first().click();

    await page.getByRole("button", { name: /add site/i }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    await expect(dialog.getByLabel(/data source/i)).toBeVisible();
    // The fields that no longer exist, because the source answers for them.
    await expect(dialog.getByLabel(/site label/i)).toHaveCount(0);
    await expect(dialog.getByLabel(/^processor/i)).toHaveCount(0);
  });

  test("naming who runs a site says it will not move the data source", async ({ page }) => {
    await page.goto("/projects?status=approved");
    await page.locator("table a").first().click();

    const namer = page.getByRole("button", { name: /who runs it/i }).first();
    await expect(namer).toBeVisible();
    await namer.click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    // The sentence that stops somebody reaching for this when they meant to
    // reassign the rig — and reassigning three studies by accident.
    await expect(dialog.getByText(/the data source keeps its owner/i)).toBeVisible();
    await expect(
      dialog.getByText(/every other project collecting from it is untouched/i),
    ).toBeVisible();
  });

  test("attaching a source is a separate control from naming a person", async ({ page }) => {
    // Two decisions that look alike and are not. If they ever collapse into one
    // button, the one that moves every project wins by accident.
    await page.goto("/projects?status=approved");
    await page.locator("table a").first().click();

    await expect(page.getByRole("button", { name: /attach source|change source/i }).first())
      .toBeVisible();
    await expect(page.getByRole("button", { name: /who runs it/i }).first()).toBeVisible();
  });
});

test.describe("one project, two collection owners", () => {
  // Reported against a live project: a study collecting at a third party's
  // campus and at an in-house lab showed both sites to the DCO, and let them
  // mint a consent link for the in-house one. Each owner sees their own.
  const sitesOn = async (page: import("@playwright/test").Page) => {
    await page.goto("/sites");
    await page.locator("table tbody tr, [role=row]").first().waitFor({ timeout: 15_000 });
    return page.locator("main").innerText();
  };

  test.describe("as the DCO", () => {
    test.use({ storageState: statePath("dco") });

    test("sees the third-party site and not the in-house one", async ({ page }) => {
      const text = await sitesOn(page);
      expect(text).toContain("CIT");
      expect(text, "SE is collected in-house and belongs to the RCO").not.toContain(
        "SRC-SRIB-SE",
      );
    });
  });

  test.describe("as the RCO", () => {
    test.use({ storageState: statePath("rco") });

    test("sees the in-house site and not the third-party one", async ({ page }) => {
      const text = await sitesOn(page);
      expect(text).toContain("SE");
      expect(text, "CIT is a third party's and belongs to the DCO").not.toContain(
        "SRC-SEED-CIT",
      );
    });
  });
});

test.describe("adding a collector after approval", () => {
  test.describe("as the R&D owner", () => {
    test.use({ storageState: statePath("rnd") });

    test("asking is framed as a request, not an edit", async ({ page }) => {
      // The whole point of the flow: an approved project must never collect
      // through an organisation the DPO has not seen, and forbidding the change
      // outright left a study expanding to a second campus with nowhere to go.
      await page.goto("/projects?status=approved");
      await page.locator("table a").first().click();

      await expect(page.getByRole("heading", { name: /who is collecting/i })).toBeVisible();
      await page.getByRole("button", { name: /request a collector/i }).click();

      const dialog = page.getByRole("dialog");
      await expect(dialog.getByText(/the dpo has to agree before anything can collect/i))
        .toBeVisible();
    });

    test("every collector says where it stands", async ({ page }) => {
      // A list of names with no status would leave both readers working out
      // which ones are real — and "real" is the difference between a collector
      // and a request.
      await page.goto("/projects?status=approved");
      await page.locator("table a").first().click();

      const card = page.locator("section, div").filter({
        has: page.getByRole("heading", { name: /who is collecting/i }),
      });
      await expect(card.getByText(/approved|awaiting the dpo|refused/i).first()).toBeVisible();
    });
  });

  test.describe("as the DPO", () => {
    test.use({ storageState: statePath("dpo") });

    test("the decision is on their dashboard, not buried in the project", async ({ page }) => {
      // Its own queue: a live project waiting to expand looks like nothing is
      // wrong, which is how it gets left sitting.
      await page.goto("/dashboard");
      await expect(
        page.getByText(/new collectors awaiting your decision/i),
      ).toBeVisible();
    });
  });
});

test.describe("R&D User", () => {
  test.use({ storageState: statePath("rnd") });

  test("the project form says where an approved project will go", async ({ page }) => {
    await page.goto("/projects");
    await page.getByRole("button", { name: /register a project/i }).click();
    const dialog = page.getByRole("dialog");

    // Nothing said until a processor is chosen: there is no routing to describe.
    await expect(dialog.getByText(/once the dpo approves this/i)).toHaveCount(0);

    // The accessible name carries the routing line as well as the processor's
    // name — "SRIB collected in-house" — which is what a screen reader should
    // hear, so the locator matches that rather than the name alone.
    await dialog.getByRole("checkbox", { name: /^SRIB collected in-house$/ }).check();
    await expect(dialog.getByText(/comes back to you to name the data sources/i)).toBeVisible();

    // Both at once is the ordinary case, not an edge one, and the sentence has
    // to cover it rather than picking whichever was ticked last.
    await dialog.getByRole("checkbox", { name: /^SEED collected by a third party$/ }).check();
    await expect(dialog.getByText(/the dco admin assigns the data sources/i)).toBeVisible();
    await expect(dialog.getByText(/comes back to you to name the data sources/i)).toBeVisible();
  });

  test("can author a notice, which used to be the DPO's alone", async ({ page }) => {
    await page.goto("/notices");
    // The section itself is the assertion: an R&D User with no Notices page
    // cannot write the notice they are now responsible for writing.
    await expect(page.getByRole("heading", { name: /notices/i }).first()).toBeVisible();
  });
});
