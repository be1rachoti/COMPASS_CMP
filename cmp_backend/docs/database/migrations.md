# Migrations

Alembic for ordering and reversibility. **Every migration is raw SQL.**

## Why raw SQL

`DATA-MODEL.md` specifies exact types, constraints, triggers and grants.
Autogenerate reproduces none of that faithfully, and the difference between
`text` and `varchar(200)`, or a missing trigger, is not visible in a diff of
models.

## The chain

| Rev | Contains |
|---|---|
| `0001` | Baseline: 22 tables, 25 enums, the `v_current_consent` view, indexes, CHECKs |
| `0002` | Enforcement: append-only triggers, the SHA-256 audit chain, notice freeze rules |
| `0003` | Least privilege: revokes `UPDATE`/`DELETE` from the application role on evidence tables |
| `0004` | Two defects found by exercising 0001/0002 against a real server |

## What 0004 fixed

**The empty-array CHECK.** `array_length(x, 1) >= 1` passes on an empty array,
because `array_length` returns NULL and a CHECK passes on NULL. Replaced with
`cardinality()`, behind a guard that refuses to apply if offending rows exist.

**A `format()` specifier in `cmp_append_only()`.** A bare `%` raised
"unrecognized format() type specifier". The statement was still refused — the
trigger worked — but the message was useless to whoever hit it.

## Reversibility is tested

CI runs `upgrade → downgrade → upgrade` on every push. The rollback path is
proven to work **before** it is needed, which is the only time anyone finds out
otherwise.

## The env is synchronous

`migrations/env.py` uses a sync engine. psycopg's async mode cannot run under
Alembic's runner, and a migration is not a place to be clever about event loops.

## Adding one

```bash
uv run alembic revision -m "what it does"
```

Then write the SQL by hand. Both directions. Test the downgrade before you commit
the upgrade.
