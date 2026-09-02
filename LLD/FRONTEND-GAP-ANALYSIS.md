# Frontend — what it does, and what is missing

A gap analysis of the Next.js application against the 164 endpoints the API
serves, the DPDP obligations the platform exists to meet, and the project's own
architecture rules.

> Every number here was measured, not estimated. The method is in §6 so each
> claim can be re-run and disagreed with.

---

## Summary

| | |
|---|---|
| Routes | 31 pages |
| Feature modules | 16 |
| Components | 90 |
| API endpoints wired | **135 of 164 (82%)** |
| Frontend calls to endpoints that do not exist | **0** |
| Features with any unit test | **1 of 16** |

**The API surface is well covered.** 82% of endpoints have a caller, and — worth
stating because it is the failure mode you would expect — the frontend never
calls an endpoint the backend does not serve. The generated types plus the
contract test are doing their job.

**The gaps are not where the coverage number suggests.** Four are defects in
shipped features, and the most serious missing screens are the ones a regulator
would ask for.

---

## 1. Defects in what already ships

These are wrong today, in features users are already using.

### 1.1 Every dashboard count link lands on an unfiltered list

**Confirmed · affects every role · 8 links**

The dashboard renders counts as links carrying a filter:

```
/projects?status=in_draft      /projects?status=pending_approval
/projects?status=approved      /projects?status=closed
/notices?status=draft          /purposes?status=draft
/consents?status=withdrawn     /links?status=active
```

Of the destination pages, **exactly one reads `useSearchParams`** — `/sources` —
and no link points at it. So a DPO who clicks "**7** pending approval" gets the
full project list and has to filter again by hand, with no indication the filter
was dropped.

The fix is per destination page, not per link: read the param, seed the filter
state from it.

### 1.2 A collection-site dropdown can silently omit valid options

**Confirmed · latent · fires when the registry passes 50 active sources**

[`site-owner.tsx:125`](../cmp_frontent/src/features/projects/components/site-owner.tsx#L125)
requests sources with **no `limit`**, so the server applies
`default_page_size = 50`. The component then filters that page client-side down
to the project's processors.

Once the registry holds more than 50 active sources, a source that belongs to
the project's processor can be absent from the first page — and the dropdown
simply will not offer it. Nothing errors. The DCO Admin concludes the source is
not registered.

[`site-form.tsx:49`](../cmp_frontent/src/features/projects/components/site-form.tsx#L49)
has the same shape with `limit: 100`, which delays the same failure rather than
preventing it.

The registry currently holds 9 sources, so this has not bitten yet. The fix is a
server-side filter — `?processor=<uuid>` — rather than a larger page.

### 1.3 The data subject reads a staff page

**Confirmed · not a leak**

`nav_for(data_subject)` returns `['consents', 'notifications', 'profile']`, so a
data principal is given a **Notifications** item that routes to
`/(app)/notifications` — the staff page, in the staff shell.

The endpoint behind it is safe: `GET /notifications` branches on role and calls
`audit_repo.for_subject(...)` with `for_subject=True` link resolution, so she
sees her own events resolved to her own pages. **No data leak.**

But the purpose-built `GET /me/notifications` — gated `RequireDataSubject`, doing
*the same two calls* — has no caller anywhere in the frontend. One feature, two
implementations, and a bug fixed in one will not reach the other.

### 1.4 One concept, two spellings

The API exposes `/consents` while the domain and repository call it `consent`;
the frontend mirrors the split. Cosmetic, but it means a search for either finds
half the code.

---

## 2. Backend capability with no interface

29 endpoints have no frontend caller. Seven are infrastructure a browser should
never call (`/health`, `/metrics`, `/ready`…). Of the remaining 22, most are
single-resource `GET`s whose data the list row already carries — genuinely
unnecessary.

**These eight are not.**

### 2.1 The disclosure register has no screen — s.11(1)(b)

| | |
|---|---|
| `GET /exports/{uuid}/lines` | *"Who was in this file"* |
| `GET /assets/{uuid}/subjects` | *"One row per subject, bystanders included"* |

The DPDP Act gives a data principal the right to know **who her data was shared
with**. The backend computes it, records it per export line, and serves it. There
is no page that shows it — not to the DPO, and not to her.

This is the highest-value gap in the analysis: the obligation is met in the
database and unmet in the product.

### 2.2 A notice cannot be previewed, versioned, or corrected

| | |
|---|---|
| `GET /notices/{uuid}/preview` | No way to see the notice as a data principal will |
| `GET /notices/{uuid}/versions` | No version history, for a document whose text is frozen and hashed per version |
| `PUT /notices/{uuid}/languages/{code}` | A rendition can be **added** but never **edited** — a typo in the Hindi text means deleting and re-adding |

The DPO approves each language rendition individually and publication freezes the
text into every consent artefact. Approving text you cannot preview, with no
history of what the previous version said, is the review being asked to happen
without the material.

### 2.3 The public notice viewer is unbuilt

`GET /notice/{uuid}` is **unauthenticated** — built so anyone can read a
published notice without an account. There is no page. The transparency surface
exists in the API and nowhere a person can reach.

### 2.4 Person-type history is invisible

`GET /users/{uuid}/person-type-history` tracks employee → ex-employee
transitions. The `person_type_history` table exists and is empty; nothing writes
to it through the UI and nothing displays it. Retention and lawful basis both
depend on that status.

### 2.5 A single audit entry cannot be opened

`GET /audit/{uuid}` serves one entry. The trail lists entries and shows a detail
dialog from the list row, so the deep link has no page — meaning an audit entry
cannot be linked to from anywhere, including from an incident report.

---

## 3. Testing — the largest structural gap

**Fifteen of sixteen feature modules have no unit test at all.**

| Feature | Tests |
|---|---|
| `projects` | 2 files |
| account · audit · auth · consent · dashboard · delegations · exchange · meta · my-consents · notices · notifications · public-consent · registry · rights · users | **none** |

The seven other test files are library-level — `format`, `sanitize`, `api-error`,
`schemas`, `resource-list`, `security`, `forms`. Valuable, but they test the
foundation, not the features built on it.

Against **rule 14** — *tests must accompany new business functionality* — this is
the rule the codebase is furthest from. It includes the notice importer added
this week: it has backend tests and an e2e spec, and no frontend unit test.

Ten Playwright specs partly compensate by covering journeys end to end, but they
are slow, need a live database, and cannot cover a component's branches.

---

## 4. What is already right

Reporting only gaps would misrepresent the state of this codebase.

- **Zero phantom calls.** Not one call to an endpoint the backend does not serve
  — generated types plus a contract test, working as designed.
- **Accessibility is enforced, not aspirational.** `jsx-a11y` rules are set to
  `error` in the flat config, so `alt-text`, `aria-props` and `aria-proptypes`
  fail the build rather than warn.
- **Server state and form state are properly separated** — TanStack Query and
  React Hook Form, not one store doing both badly.
- **Errors are typed.** `api-error.ts` gives every failure `isForbidden` and
  `userMessage()`, so pages distinguish "not allowed" from "went wrong".
- **The role gate is server-driven.** `me.nav` decides the sidebar, so a role
  added in the backend cannot silently lose its section in the UI.

---

## 5. What I would do, in order

| # | Work | Why first |
|---|---|---|
| 1 | Read `?status=` on the 7 destination pages | 8 broken links, every role, hours not days |
| 2 | Server-side `?processor=` filter for source dropdowns | Silent wrong behaviour; cost rises with the registry |
| 3 | Disclosure screen — export lines and asset subjects | The statutory gap; data exists, only the screen is missing |
| 4 | Notice preview + version history | The DPO approves text they cannot see |
| 5 | Point the data subject at `/me/notifications`, delete the duplicate branch | Removes a drift risk while it is still cheap |
| 6 | Public notice viewer | Transparency surface; a page over an endpoint that already works |
| 7 | Unit tests for `notices`, `consent`, `exchange` | Highest-risk features, currently untested |
| 8 | Editable language renditions | Real, but a workaround exists |

Items 1 and 2 are defects. Items 3, 4 and 6 are obligations with the hard part
already built. Item 7 is the one that stops this list regrowing.

---

## 6. Method

So the numbers can be checked rather than believed.

**Endpoints** — the FastAPI application object, walked through the nested
`_IncludedRouter` wrappers, taking each endpoint's `principal` annotation as its
gate. 164 routes.

**Frontend calls** — a regex over every non-test `.ts` in `src/`, matching
`apiGet` / `apiPost` / `apiPut` / `apiPatch` / `apiDelete` / `apiDownload` /
`http.*`, then normalising `${...}` to `{p}` and stripping a trailing
`${queryString(...)}`.

Two extraction bugs were found and fixed while running this, both of which
inflated the gap:

- `<[^>]*>` for type arguments stops at the first `>`, so **every paginated call
  was skipped** — `apiGet<Page<Project>>(...)` matched nothing. This alone hid
  17 calls and made `/projects`, `/users` and `/notices` look unwired.
- A trailing `${queryString(filters)}` was being turned into a path segment.

The first pass reported 46 unwired endpoints. The corrected figure is 22, of
which 8 matter. **A gap analysis is only as good as its extractor**, and the
first two answers this one gave were wrong.

**Everything else** — read directly: `nav_for()` resolved per role from
`core/permissions.py`, the dashboard link list from `dashboard/components/config.ts`,
`useSearchParams` usage by grep across `src/app/(app)`, test files by `find`.

---

Measured on the current branch. Counts reflect the repository at analysis time.
