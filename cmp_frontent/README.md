# CMP — Consent Management Platform (frontend)

The console and the public consent flow for the CMP backend. Next.js 16 (App
Router), React 19, TypeScript strict, Tailwind 4, TanStack Query.

---

## Running it

```bash
npm install
cp .env.example .env.local     # point NEXT_PUBLIC_API_URL at the API
npm run dev
```

The API must be running (see the backend README). `npm run verify` runs the type
check, the linter and the unit tests together.

> If every button appears to do nothing in development, check the browser console
> for `403` on `/_next/static/chunks/*`. Next 15.2+ refuses dev assets from an
> origin it does not recognise, and `localhost` and `127.0.0.1` are different
> origins to that check — the page renders, nothing hydrates, and the failure is
> silent. `allowedDevOrigins` in `next.config.ts` lists both.

| Script | Does |
|---|---|
| `npm run dev` | Development server |
| `npm run build` | Production build — fails on a type or lint error |
| `npm run verify` | typecheck + lint + unit tests |
| `npm test` | Vitest |
| `npm run e2e` | Playwright, against a real browser and a real API |
| `npm run api:types` | Regenerate types from the live OpenAPI document |

---

## How it is put together

```
src/
  app/                    routes
    (app)/                authenticated — wrapped in RequireAuth + AppShell
    c/[token]/            the public consent flow
    sign-in/              staff password + MFA, data-subject OTP
    rights/               public rights information (Rule 9, Rule 14(1))
  components/
    ui/                   primitives and status rendering
    project/              transition controls
  lib/
    api-client.ts         axios: credentials, CSRF, error normalisation, 401
    api-error.ts          the API's error contract, as a type
    queries.ts            one hook per endpoint, with the query keys
    types.ts              curated API types
  providers/              query, theme, toast, auth
```

### The rules the frontend follows

**It holds no copy of the permission matrix.** Navigation comes from `me.nav`,
computed by the server. A local copy drifts, and a drifted copy shows people
buttons that 403 on click.

**It holds no copy of the state machine.** The project transition controls are
rendered entirely from `GET /projects/{uuid}/transitions`: which transitions
exist for this role, whether each is allowed, and what is blocking the others. A
blocked transition renders as a *disabled button with its reason* rather than
being hidden — hiding it leaves the user unable to work out what to fix.

**The session is never touched by JavaScript.** It is an HttpOnly cookie, so
"who am I" is answered by asking `GET /auth/me`. That costs one request on first
paint and removes the entire "XSS exfiltrates the token" class. The cost is CSRF,
which the double-submit header in `api-client.ts` pays.

**Errors are parsed once.** Every failure becomes an `ApiError` carrying the
server's code, field and request id. Components branch on `isValidation`,
`isConflict`, `needsMfa`; nobody reads a response body.

**Nothing 4xx is retried.** A 403 will still be a 403 on the fourth attempt, and
retrying produces three more audited access denials in the DPO's log. Mutations
are never retried at all — they write to append-only tables, and a retried export
would corrupt the disclosure record.

---

## The consent flow

`src/app/c/[token]` is the only screen a data subject is required to use, and the
decisions in it are not cosmetic:

- **Nothing is pre-ticked.** Consent has to be an affirmative action; a
  pre-ticked box is not one.
- **Accept and Decline have equal prominence.** Making refusal harder to find
  than agreement is the pattern the statute is aimed at, and withdrawal must be
  as easy as consent was.
- **Every purpose must be answered.** Silence is not consent, so the submit
  button stays disabled until each one has an explicit yes or no. Declining
  answers them all with a no rather than sending a partial set.
- **`served_at` comes from the server** and is echoed back untouched. It is what
  evidences s.5(1) — that the notice was given before consent was asked for — and
  a client-supplied timestamp would make that unfalsifiable.
- **An invalid link renders no notice content**, and does not say *which* of
  expired, revoked or mistyped it was. Naming one tells a token-guesser which of
  their guesses was structurally valid.

---

## Design system

Tokens live in `src/app/globals.css` and nowhere else. Colour is OKLCH, so equal
lightness steps look equal and the palette stays balanced when inverted for dark
mode instead of turning muddy.

Three states, not two: light, dark and **system**, with a live media-query
listener so an OS that switches at sunset switches the app too. The class is
applied by an inline script before first paint, so there is no white flash.

**Colour never carries meaning alone.** Every status badge shows its label, so the
information survives greyscale printing and colour-blindness. Withdrawal is amber
rather than red — it is a right being exercised, not an error.

---

## Testing

```bash
npm test                                    # unit
npm run e2e                                 # end-to-end
E2E_CONSENT_TOKEN=<token> npm run e2e       # includes the consent journey
```

Unit tests cover the pieces where a mistake is invisible in review: error
classification, and the formatting of values a data subject reads (a retention
period rendered as `P3Y` instead of "3 years" is a notice nobody understands).

End-to-end tests run in a real browser because that is the only place the things
being tested exist: the HttpOnly cookie, the CSRF header, and the multi-step
consent journey. They assert the security properties too — that an unauthenticated
visitor never sees a flash of the page before redirecting, and that a failed
sign-in does not reveal whether the account exists.

The public-surface tests run **serially**. That surface is rate limited per
address, and parallel workers share one address from the API's point of view;
running them concurrently makes them contend with a control that is working
correctly and produces failures that look like application bugs.
