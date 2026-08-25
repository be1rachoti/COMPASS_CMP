# CMP — Consent Management Platform (backend)

Consent management under the **Digital Personal Data Protection Act 2023** and the
DPDP Rules 2025. FastAPI, PostgreSQL 16+, Redis, Celery.

The authoritative documents are `DATA-MODEL.md` (22 tables) and the API reference
(114 endpoints). Where this codebase and those documents disagree, they win and
this is the bug — with one deliberate exception, recorded in
[migration 0004](migrations/versions/0004_constraint_fixes.py) and explained under
[Deviations](#deviations-from-the-specification).

---

## Running it

Two datastores are required. Either install them natively or run the two
containers; the application itself runs the same way in both cases.

### Native (Windows shown; adjust for your platform)

```bash
winget install --id PostgreSQL.PostgreSQL.17 --silent \
  --override "--mode unattended --superpassword <pw> --serverport 5432"
winget install --id Memurai.MemuraiDeveloper --silent   # Redis 7.2-compatible

psql -U postgres -c "CREATE ROLE cmp LOGIN PASSWORD 'cmp' CREATEDB"
psql -U postgres -c "CREATE DATABASE cmp OWNER cmp"
```

### Containers

```bash
docker compose up -d db redis
```

### Then

```bash
uv sync                        # install, from the lock file
cp .env.example .env           # edit if your datastores are not on localhost
uv run alembic upgrade head    # 22 tables, 25 enums, triggers, grants
uv run python scripts/seed.py  # one coherent world: users, project, notice, link

uv run python -m cmp --port 8000
uv run celery -A cmp.tasks.app:celery_app worker --pool=solo --loglevel=info
uv run celery -A cmp.tasks.app:celery_app beat  --loglevel=info
```

`http://127.0.0.1:8000/docs` for the interactive reference (development only —
it is disabled in production).

> **Why `python -m cmp` and not `uvicorn cmp.main:app`?**
> psycopg's async mode cannot run on Windows' `ProactorEventLoop`, and uvicorn
> 0.36+ builds its loop through a `loop_factory`, which bypasses the event-loop
> *policy*. The module entrypoint supplies the loop itself. On Linux the two are
> equivalent; production uses gunicorn (see the `Dockerfile`).

### Development codes

OTP and MFA codes are hashed before storage and are never logged — which makes
signing in locally impossible without somewhere to read them. In `local` and
`test` only, delivered messages are appended to `var/outbox.log`. The guard is on
`settings.environment`, checked before anything is formatted, so a production
process never writes one.

---

## Architecture

```
HTTP  →  middleware  →  router  →  permission guard  →  service  →  repository  →  PostgreSQL
         request id      parse       role + scope       business      raw SQL       triggers
         audit ctx       validate    in the WHERE       rules         psycopg       constraints
         headers         no SQL      clause             audit.record()              grants
```

| Layer | Directory | May do | May not do |
|---|---|---|---|
| API | `src/cmp/api/` | Parse, validate shape, resolve role | Business logic, SQL |
| Domain | `src/cmp/domain/` | Business rules, transitions, **all writes** | Touch HTTP |
| Repository | `src/cmp/db/` | SQL | Business logic |
| Database | `migrations/` | Constraints, triggers, grants | — |

**There is no ORM, deliberately.** `DATA-MODEL.md` is authoritative; an ORM model
would be a second copy of it that drifts, and every review would then diff against
the wrong source of truth. Repositories write the SQL that actually runs, and
Alembic migrations carry raw DDL.

**Only services write.** A router that writes bypasses `audit.record()`, and that
is how audit trails end up patchy. The audit row and the change it describes share
one transaction, so a change that rolled back leaves no audit row claiming it
happened, and a change that committed cannot be missing one.

### Build order

Forced by foreign keys, not preference:

```
accounts → audit → registry → projects → notices → consent → exchange → circular FKs
```

Audit is second on purpose. Retrofitting audit coverage across a finished codebase
means hand-checking every write path, and missing some.

---

## What the database enforces

The application already refuses these. The database refuses them too, because
"the application always calls the service layer" is a claim about a codebase, and
a codebase changes. A trigger is a claim about the data.

| Guarantee | Mechanism | Test |
|---|---|---|
| Audit is append-only | trigger + revoked grant | `TestAppendOnly` |
| Audit rows are hash-chained | `cmp_audit_chain()`; `GET /audit/verify` walks it | `TestAuditChain` |
| A published notice is frozen | `cmp_notice_freeze()` | `TestPublishedNoticeIsFrozen` |
| The artefact carries the hash of the text served (INV-4) | `cmp_consent_coherent()` | `TestConsentCoherence` |
| Notice served before consent (s.5(1)) | `CHECK served_before_action` | `TestConsentCoherence` |
| One artefact superseded once | partial unique index | `TestConsentCoherence` |
| Bystanders may exist (INV-12) | nullable `consent_id` + CHECK | `TestAssetConsent` |
| Data categories are itemised (Rule 3(b)(i)) | `CHECK cardinality(...) >= 1` | `TestPurposeConstraints` |
| Links only for approved projects | `cmp_link_coherent()` | `TestLinkIntegrity` |

Consent evidence, disclosure records and history tables are all append-only.
Withdrawal is a **new artefact that supersedes the old one**, never an edit —
the supersession chain *is* the record.

---

## Conventions

**Identifiers.** Every path parameter and every response field is a `uuid`. The
integer primary key never appears in a URL, a body, an export or a log; it is
stripped in `build_page` and filtered by the response models. `/c/{token}` is the
single exception — a capability, not a reference.

**Pagination.** Cursor, never offset, on every list endpoint. Offset pagination
skips or repeats rows when the underlying set changes between pages, which it will
during a collection campaign. Cursors are HMAC-signed: they are interpolated into
the next query's comparison, so an unsigned one is an injection vector.

**Filters.** Unknown query parameters are `400`, never ignored. A typo in a filter
that silently returns everything is how the wrong people see the wrong rows.

**403 vs 404.** Scope lives in the `WHERE` clause. A row outside your scope is
absent, which surfaces as `404`; `403` would confirm it exists. `403` is reserved
for a resource you can see but may not act on — and every one is audited.

**Errors.** One shape everywhere:

```json
{"error": {"code": "notice_incomplete", "message": "…", "field": "…", "request_id": "…"}}
```

---

## Testing

```bash
uv run pytest                      # everything
uv run pytest -m "not integration" # no datastores needed
uv run pytest --cov                # with coverage
```

Unit tests are pure functions — the transition table, the permission matrix, the
crypto primitives. Integration tests run against a real PostgreSQL and bypass the
service layer on purpose: if a guarantee only holds when you go through Python, it
is not a guarantee.

The transition test asserts all **125** (from, to, role) combinations, not just
the 7 that are legal. That is what catches a future edit adding a shortcut from
`in_draft` straight to `approved`.

---

## Deviations from the specification

**One, and it is a defect in `DATA-MODEL.md`.** That document declares:

```sql
CONSTRAINT categories_not_empty CHECK (array_length(data_categories, 1) >= 1)
```

`array_length('{}', 1)` returns `NULL`, not `0`. `NULL >= 1` evaluates to `NULL`,
and a CHECK constraint accepts `NULL` — it rejects only an explicit `false`. So
the constraint that exists to enforce Rule 3(b)(i) admitted a purpose with no data
categories at all. Reproduced against PostgreSQL 16 and 17:

```sql
INSERT INTO purpose (..., data_categories, ...) VALUES (..., ARRAY[]::text[], ...);
-- INSERT 0 1
```

[Migration 0004](migrations/versions/0004_constraint_fixes.py) replaces it with
`cardinality(...) >= 1`, and refuses to apply if rows that the broken constraint
admitted are already present. The same migration fixes a `format()` bug that made
the append-only trigger raise a PostgreSQL internals error instead of its intended
message — the statement was still refused, but an operator reading the log could
not tell why.

**Sessions are in Redis, not a 23rd table.** `DATA-MODEL.md` specifies 22 tables
and a session is not a record of something that happened; it is ephemeral state
with a TTL that must disappear on its own. `GET /auth/sessions` and
`DELETE /users/{uuid}/sessions` are served from Redis with a per-user index.

---

## Operations

| Endpoint | Purpose |
|---|---|
| `GET /health` | Liveness. Touches nothing. A database outage must not make every replica fail its probe and get restarted. |
| `GET /ready` | Readiness. Database, Redis, migrations current. `503` when not. |
| `GET /metrics` | Prometheus. Never templated by consent token. |
| `GET /audit/verify` | Walks the hash chain and reports the first row that does not verify. |

Scheduled work (Celery Beat, exactly one instance — two produce duplicate work):

| Task | Schedule | Idempotent because |
|---|---|---|
| `expire_consent_links` | every 15 min | matches only rows still active |
| `apply_retention_lapse` | 02:00 | matches only `disposition = 'active'` |
| `verify_audit_chain` | 03:00 | read-only |
| `flag_unmapped_assets` | every 6 h | reconciliation only; flags, never deletes |

Celery runs with `acks_late` and `reject_on_worker_lost`: a worker killed
mid-task redelivers rather than losing the work. That means **at-least-once**
delivery, which is why every task is idempotent and why imports upsert on
`(source, source_reference)`.

---

## Layout

```
src/cmp/
  core/        config, errors, logging, security, permissions, pagination, context
  api/         routers, dependencies, middleware, error handlers
  domain/      services — the only place that writes
  db/          pool, SQL helpers, repositories
  tasks/       Celery app, notifications, maintenance, dispatch policy
  schemas/     request (strict) and response (filtering) models
migrations/    raw-SQL Alembic revisions
tests/         unit (pure) and integration (real datastores)
docker/nginx/  TLS, rate limits, upload buffering, token scrubbing
```
