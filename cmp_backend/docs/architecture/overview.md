# Architecture overview

A layered FastAPI service over PostgreSQL 16 with **no ORM**, serving 144
endpoints across 22 tables.

## What the system is for

A data fiduciary registers a project, states the purposes it will process
personal data for, and publishes a notice. A data subject reads that notice at a
collection site and agrees — or refuses — purpose by purpose. Everything after
that is about being able to prove what happened, years later, to somebody who was
not there.

That last sentence is the design constraint. Most of the decisions below are
downstream of it.

## The layers

```
HTTP            routers, request/response schemas, error contract
MIDDLEWARE      request id, security headers, body limit, access log
AUTH            identity, sessions, MFA, OTP, roles, permissions, rate limits
DOMAIN          business rules, state machines, the only layer that writes
VALIDATION      shape at the boundary, rules in the domain, invariants in the DB
DATA ACCESS     repositories, hand-written SQL, transactions, Redis
DATABASE        constraints, triggers, append-only enforcement, revoked grants
ASYNC           Celery — notifications, exports, maintenance
```

**One rule holds the structure together: a layer may only call the layer below
it.** A router may not touch a connection. A repository may not decide whether
something is permitted. A service is the only thing that writes, and the only
thing that calls the audit recorder.

That is what makes the codebase navigable. To find out what happens when a notice
is published there is exactly one function that does it, and everything else
either calls it or is called by it.

## Package map

| Package | Modules | Role |
|---|---|---|
| `bootstrap/` | 6 | Assembly: factory, lifespan, middleware, routers, container |
| `api/` | 30 | Routers (v1 + public), dependencies, middleware, errors |
| `auth/` | 16 | Identity, authentication, authorisation, sessions, rate limits |
| `domain/` | 15 | One package per aggregate; the only layer that writes |
| `validation/` | 8 | The constrained types every request model is built from |
| `db/` | 12 | Pool, SQL helpers, one repository per table cluster |
| `infrastructure/` | 13 | Email, SMS, storage, outbound HTTP — swappable adapters |
| `core/` | 10 | Config, permissions, security, pagination, enums, errors |
| `tasks/` | 13 | Celery: 11 tasks, 6 queues, 4 scheduled |

## Why no ORM

`DATA-MODEL.md` is the source of truth for the schema, and the enforcement that
matters lives in the database: append-only triggers, 188 CHECK constraints, a
revoked `UPDATE` grant, a SHA-256 hash chain. An ORM would put a second, softer
model in front of that, and the second model drifts.

Every query is hand-written SQL over psycopg 3 with values bound as parameters.
The only interpolated fragments are validated identifiers — a sort column checked
against a per-route allow-list, a scope predicate chosen by an enum — and ruff's
S608 rule is suppressed per-directory for exactly those files, so it still guards
the layers where no SQL belongs at all.

## Three properties worth knowing before reading the code

**Consent is per purpose, never in aggregate.** A record says which purposes were
agreed and which were not, one row each. "3 of 5" is not a record of what somebody
agreed to.

**Withdrawal supersedes; it never edits.** Withdrawing writes a new artefact
pointing at the one it replaces. The earlier record survives as evidence of what
was agreed at the time.

**Identifiers on the wire are uuids.** No integer primary key appears in a URL, a
response body, an export or a log. A sequential id says how many rows exist and
invites walking the neighbours.

See [layers.md](layers.md) for what each layer may and may not do, and
[dependency-rules.md](dependency-rules.md) for the import graph.
