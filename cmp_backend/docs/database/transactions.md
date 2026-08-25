# Transactions

## The unit of work

`db/pool.py` offers two context managers:

* `connection()` — a connection for reads.
* `transaction()` — a connection inside a transaction, committed on clean exit
  and rolled back on any exception.

A router that writes opens `transaction()` and hands the connection to a service.
The service does everything inside it.

## What must be in one transaction

**A change and its audit row.** Always. This is what makes the audit trail a
property rather than a convention — there is no window in which the change exists
and the record of it does not.

**A transition and its side effects.** `in_draft → under_process` publishes the
project's notice. Both happen together, or a project would be under process with
an unpublished notice.

**An import.** A manifest either lands or does not. Splitting it across a queue
would make `partial` mean two different things.

**An export and its lines.** The disclosure record and the file must agree.

## Timeouts

Set on the connection, not left to hope:

| Setting | Default | Stops |
|---|---|---|
| `db_statement_timeout_ms` | 15,000 | A runaway query holding a worker |
| `db_lock_timeout_ms` | 5,000 | A blocked write queueing behind a long read |

## Row locks

`require_for_update` takes `FOR UPDATE` on a project before a transition reads
its facts, so two concurrent transitions cannot both see the same starting state
and both succeed.

## Tests run in a rolled-back transaction

Each integration test gets a connection whose transaction is rolled back
afterwards, so tests neither see nor leave each other's rows — and the suite can
run against a database with real data in it without touching it.
