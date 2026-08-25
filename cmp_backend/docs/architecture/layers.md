# Layers

What each layer owns, what it may call, and what would be a bug.

## The rule

**A layer may only call the layer below it.** Everything else in this document
follows from that.

| Layer | May call | Must never |
|---|---|---|
| `bootstrap/` | everything | be imported by anything below it |
| `api/middleware` | the app | read a database row |
| `api/routers` | domain services, dependencies | write SQL, open a transaction it does not hand to a service |
| `api/dependencies` | `auth`, `core` | know the shape of any specific resource |
| `auth/` | `domain` repositories, `core` | import from `api` |
| `domain/` | repositories, `core`, `infrastructure` | import FastAPI, know an HTTP status code |
| `db/repositories` | `db/sql`, `core` | decide permission, call another repository |
| `infrastructure/` | `core` | import from `domain`, `auth` or `api` |
| `core/` | nothing local | import from `db`, `domain`, `auth` or `api` |

## Why each boundary exists

### Routers are thin

A router validates the request shape, names its guard, calls one service, and
shapes the response. Business logic in a router is the single easiest way to end
up with two versions of a rule — one in the router and one in the service that a
task also calls.

### Services are the only writers

And the only callers of `audit.record()`. That is what makes "every change is
recorded" a property of the structure rather than a convention somebody has to
remember. A write that happened without an audit row is not a state the database
can reach, because both happen in the same transaction.

### Repositories do not decide permission

They receive a role and a scope and turn it into a WHERE predicate. A repository
that decided whether something was allowed would be a second authorisation
system, and the two would disagree.

### `core/` imports nothing local

Half the codebase needs to name a `Role`. If `core` imported from `auth`, then
`db`, `domain` and `api` would all pull the authorisation package in transitively
and the graph would have no direction left. This is why the permission **table**
lives in `core` while the permission **policy** lives in `auth`.

### `infrastructure/` does not know the domain exists

An email transport that reached back into a service would be a circular import
today and an untestable module tomorrow. Adapters are called; they do not call.

## Where each kind of check belongs

Three kinds, and keeping them apart is what stops each being done in the wrong
place:

| Kind | Example | Where | Why there |
|---|---|---|---|
| **Shape** | is this a string of ≤200 chars, a uuid, an http URL | Pydantic, at the boundary, from `validation/` | Cheapest, and it never reaches a service |
| **Rule** | may this project move to that state | the domain | Needs the current row to decide |
| **Invariant** | can this row exist at all | the database | Must hold for a write that never saw Python |

The third is the one people skip. A CHECK constraint holds for a migration, a
psql session and a bug — a Python check holds for the code path somebody
remembered.
