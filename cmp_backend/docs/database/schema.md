# Schema

22 tables, 25 enums, 1 view, 188 CHECK constraints, 21 triggers, 89 indexes.

`DATA-MODEL.md` is the source of truth. Migration 0001 transcribes it; this
document explains the parts whose shape is not obvious.

## Table groups

| Group | Tables |
|---|---|
| Identity | `auth_user`, `person_type_history` |
| Registry | `purpose`, `processor`, `data_source` |
| Projects | `project`, `project_status_history`, `project_approval`, `project_site` |
| Notices | `notice`, `notice_purpose`, `notice_language` |
| Consent | `consent_link`, `consent_artefact`, `consent_purpose_grant` |
| Exchange | `export_log`, `export_line`, `import_batch`, `collection`, `data_asset`, `asset_consent` |
| Audit | `audit_log` |

## The view

`v_current_consent` resolves the supersession chain to the artefact that is
currently in force for each (subject, notice) pair. Consent status is **derived
from it on every read, never stored** — a denormalised status column is a second
copy of the truth and the copy goes stale the first time a grant changes without
it.

## Shapes worth explaining

**`consent_artefact` has no status column.** Status is derived from the grants:
all granted is `consented`, some is `partial`, none is `declined`, and
`is_withdrawal` is `withdrawn`.

**Withdrawal supersedes.** A withdrawal is a new artefact with
`supersedes_consent_id` pointing at the one it replaces. The earlier row is never
touched — and could not be, since the table refuses `UPDATE`.

**`asset_consent` allows a NULL `consent_id`.** That is the bystander: somebody
in frame who never consented. The row exists precisely so they can be found and
dealt with. Forbidding it would mean the unlawful state existed and was invisible.

**`password_hash` is nullable.** Data subjects have no password. See
[../security/authentication.md](../security/authentication.md).

## The deliberate deviation from DATA-MODEL.md

The document specifies:

```sql
CHECK (array_length(data_categories, 1) >= 1)
```

That constraint **admits an empty array**. `array_length` returns `NULL` for one,
`NULL >= 1` is `NULL`, and a CHECK passes on `NULL`. Reproduced with a real
`INSERT` before anything was changed.

Migration 0004 replaces it with `cardinality(...) >= 1`, behind a guard that
refuses to apply if offending rows already exist — a migration that fails loudly
beats one that deletes data to satisfy itself.

## Enum parity

`core/enums.py` mirrors all 25 PostgreSQL enum types.
`tests/integration/database/test_enum_parity.py` asserts members and order
against a live server, in both directions, so the mirror cannot drift silently.
