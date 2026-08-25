# The audit trail

## What it guarantees

Every write to the platform records one entry, in the **same transaction** as the
change. A change that happened without an audit row is not a state the database
can reach.

## Append-only, four deep

1. No mutating route is registered on the resource.
2. The permission matrix grants no role write access.
3. `UPDATE` and `DELETE` are revoked from the application's database role
   (migration 0003).
4. A statement-level trigger refuses the statement (migration 0002).

Each layer alone would be a convention. Together they are a property.

## The hash chain

Each row carries a SHA-256 digest over its own canonical content **and its
predecessor's digest**.

Editing row N changes its digest, which no longer matches what N+1 recorded. So
verification does not answer "something changed" — it answers **"the trail is
sound up to exactly here"**, which is the answer somebody investigating actually
needs.

`GET /audit/verify` recomputes it. `cmp.maintenance.verify_audit_chain` runs it
daily, because a claim nobody checks is a claim nobody should believe.

## Reading it

The trail records `notice#42` — a table name and a surrogate key — because that
is the only reference guaranteed to stay valid. Codes get reused, projects get
renamed, people leave.

Precise, and unreadable. `db/repositories/entities.py` resolves the pair at read
time into a label, a public uuid and an in-app route: one query per entity type
on a page, never one per row. A row that no longer exists resolves to nothing
rather than an error — the trail outlives what it describes, and an evidence log
that fails to load because of one dangling reference is not a log.

## Denials are events too

`auth.access_denied` records a refused request with the reason. An access-control
system that refuses correctly but silently tells an operator nothing about
somebody probing, or a role provisioned wrongly.

## What is not in it

Credentials, one-time codes, consent link tokens, and the contents of a data
asset. The trail says *what was done to which record by whom*, not what the
record contained.
