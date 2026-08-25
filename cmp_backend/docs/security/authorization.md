# Authorisation

Two questions, deliberately answered by different things.

## 1. May this role call this at all?

A static matrix: 16 resources × 5 roles → a grant. Checked before any work is
done, by `RequireResource` or `RequireRole`.

Two conventions:

* **A resource absent from the matrix is denied to everyone.** New endpoints fail
  closed; somebody has to add a row deliberately.
* **A role absent from a resource's row is denied it.** No wildcard, no
  inheritance. A role that should see something is named.

## 2. Which rows may this user see?

A `Scope`, which a repository turns into a WHERE predicate.

| Scope | Means |
|---|---|
| `ALL` | every row |
| `SCOPED` | rows assigned to them — for a DCO, projects they are the DCO of |
| `OWN` | rows they created, or that are about them |
| `NONE` | no rows |

**Never a filter applied after the fetch.** A row already in the response has
already been counted and has already moved a cursor. The repositories compile the
scope into SQL, so a row outside scope is never selected — which means the
service cannot forget to filter, because there is nothing to filter.

## 403 versus 404

**403 means visible but not permitted.** Anything outside your scope is 404. A
403 confirms the row exists, and existence is the fact the scope was meant to
withhold — a caller walking uuids must not be able to tell "not yours" from "not
there".

## Where it lives

| Module | Holds |
|---|---|
| `core/permissions.py` | `Role`, `Scope`, `Grant`, `MATRIX`, `NAV_BY_ROLE` — data, no behaviour |
| `auth/authorization/roles.py` | staff/privileged sets, the MFA rule |
| `auth/authorization/resources.py` | the 16 resource names as constants |
| `auth/authorization/scopes.py` | `ScopeContext`, `narrower_of` |
| `auth/authorization/evaluator.py` | pure decisions, returning a reason |
| `auth/authorization/policy.py` | `authorize()` — the front door; logs the denial |
| `api/dependencies/authorization.py` | the FastAPI guards |

The table is in `core` because four repositories read a scope out of it, and
`db` must not import from a layer above it. `core` holds the vocabulary and the
table; `auth` holds everything you do with it.

## Denials are recorded

`authorize()` logs before it raises, and the service turns that into an
`auth.access_denied` audit row. An access-control system that refuses correctly
but silently is half a system: the refusal is what tells an operator that
somebody is probing, or that a role was provisioned wrongly, or that a permission
change broke a legitimate workflow.

The message never says *why*. "Your role does not permit this" tells a legitimate
user to ask their administrator; a specific reason tells somebody probing which
door is closest to open.

## The audit trail is writable by nobody

Two roles can read it. No role can write it — and that is enforced four deep:
the route is not registered, the matrix has no write grant, the `UPDATE` and
`DELETE` privileges are revoked from the application's database role (migration
0003), and a trigger refuses the statement (0002).

The Privacy Office is audited by this table. A DPO who can edit her own audit
trail makes it worthless as evidence.
