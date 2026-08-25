# COMPASS CMP

A consent management platform built to India's **Digital Personal Data Protection
Act 2023** and the DPDP Rules 2025.

Two projects in one repository:

| Path | Stack | What it is |
|---|---|---|
| [`cmp_backend/`](cmp_backend) | FastAPI · PostgreSQL 16 · Redis · Celery | The API. 144 endpoints, raw SQL over psycopg 3, no ORM. |
| [`cmp_frontent/`](cmp_frontent) | Next.js 16 · React 19 · Tailwind 4 | The console and the public consent flow. |

---

## What the system does

A **data fiduciary** registers a project, states the purposes it will process
personal data for, and publishes a notice. A **data subject** reads that notice
at a collection site and agrees — or refuses — purpose by purpose. Everything
after that is about being able to prove what happened.

Three design decisions carry most of the weight:

**Consent is per purpose, never in aggregate.** A record says which purposes were
agreed and which were not, one row each. A count would hide the answer to the
only question that matters.

**Withdrawal supersedes; it never edits.** Withdrawing creates a new record that
points at the one it replaces. The earlier record survives as evidence of what
was agreed at the time — which is what makes the trail worth anything.

**The evidence is enforced by the database, not by the application.** Notices
freeze on publication, evidence tables refuse `UPDATE` and `DELETE` at the
trigger level, and the application role has those grants revoked. The audit log
is a SHA-256 hash chain, so tampering does not report "something changed" — it
reports "sound up to exactly here".

---

## Running it locally

Requires **PostgreSQL 16+**, **Redis** (or Memurai on Windows), **Python 3.12**
and **Node 20+**.

### Backend

```bash
cd cmp_backend
cp .env.example .env          # then edit POSTGRES_* to match your server
uv sync --all-extras --dev
uv run alembic upgrade head
uv run python scripts/seed.py # development data — refuses to run in production
uv run python -m cmp --port 8000
```

The API is on `http://127.0.0.1:8000`, with interactive docs at `/docs` outside
production.

### Frontend

```bash
cd cmp_frontent
cp .env.example .env.local
npm install
npm run dev
```

The console is on `http://localhost:3000`. Requests to `/api/*` are proxied to
the API by `next.config.ts`, so the session cookie stays first-party — a
cross-site cookie is silently dropped by the browser and looks exactly like a
broken login.

### Background workers

```bash
cd cmp_backend
uv run celery -A cmp.tasks.app worker -Q high_priority,notifications,documents,default -l info
uv run celery -A cmp.tasks.app beat -l info
```

---

## Seeded accounts

Created by `scripts/seed.py`, which refuses to run when `ENVIRONMENT=production`.
Password for all four: `SeedPassw0rd!2026`

| Role | Sign-in | Notes |
|---|---|---|
| Data Protection Officer | `dpo@cmp.local` | MFA required — the code is written to `var/outbox.log` |
| Data Collection Owner | `dco@cmp.local` | |
| R&D User | `rnd@cmp.local` | |
| Administrator | `admin@cmp.local` | MFA required |

A data subject has no password. They sign in with a one-time code sent to the
contact they registered with.

---

## Tests

```bash
# Backend — 128 tests. Integration tests need a live PostgreSQL.
cd cmp_backend && uv run pytest

# Frontend — unit
cd cmp_frontent && npm run test

# Frontend — end to end, against a running API and console
cd cmp_frontent && E2E_BASE_URL=http://localhost:3000 npx playwright test
```

CI runs lint, `mypy --strict`, both test suites, and exercises the migrations
`upgrade → downgrade → upgrade` — proving the rollback path works before it is
needed at 2am.

---

## Repository layout

```
cmp_backend/
  src/cmp/
    api/          routers, middleware, dependency guards, error handlers
    core/         config, permissions, security, pagination — imports nothing local
    domain/       the services; the only layer that writes
    db/           connection pool, SQL helpers, one repository per table cluster
    tasks/        Celery — 10 tasks, 6 queues, 4 scheduled
  migrations/     4 Alembic revisions, all raw SQL
  tests/          89 unit, 39 integration

cmp_frontent/
  src/app/        App Router — 29 routes
  src/components/ primitives, charts, forms, the app shell
  src/lib/        typed API client, queries, mutations, types
  e2e/            Playwright
```

---

## Configuration

Every setting is documented in `cmp_backend/.env.example`. Two of them matter
more than the rest:

- `SECRET_KEY` — signs sessions and cursors. Production **refuses to start** on
  the development default.
- `COOKIE_SECURE` — must be `true` anywhere but local. Production refuses to
  start if it is not.

Secrets belong in a secret manager, never in the repository. `.env` is ignored
from every directory in this tree.
