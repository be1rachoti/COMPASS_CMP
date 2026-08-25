"""Least privilege for the application database role.

Defence in depth behind the triggers in 0002. The triggers refuse the statement;
these grants mean the application role cannot even issue it. Two independent
mechanisms, because a trigger can be disabled by someone with the rights to do
so - and this is precisely the role that must not have them.

The role name is configurable so that a deployment which already provisions its
own role is not forced into ours. If the role does not exist the migration is a
no-op rather than a failure: local development runs as the owner, and refusing
to migrate a developer laptop teaches people to skip migrations.

The role name is interpolated into DDL because GRANT does not accept a bind
parameter. It comes from a module constant or an operator-set environment
variable, never from a request, and it is additionally passed through
`format(... %I)` inside PL/pgSQL, which quotes it as an identifier.

Revision ID: 0003
"""

from __future__ import annotations

import os

from alembic import op

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None

APP_ROLE = os.getenv("CMP_DB_APP_ROLE", "cmp_app")

# Append-only from the application's point of view. Note SELECT and INSERT are
# granted on audit_log - the platform must be able to write and read its own
# evidence - but UPDATE and DELETE are not, on any table in this list.
EVIDENCE_TABLES = (
    "audit_log",
    "consent_artefact",
    "consent_purpose_grant",
    "export_log",
    "export_line",
    "project_status_history",
    "person_type_history",
    "project_approval",
)


def _sql(role: str) -> str:
    revokes = "\n".join(
        f"  EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON TABLE {t} FROM %I', r);"
        for t in EVIDENCE_TABLES
    )
    return f"""
DO $$
DECLARE r text := {role!r};
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
    RAISE NOTICE 'Role % does not exist; skipping grant hardening', r;
    RETURN;
  END IF;

  EXECUTE format('GRANT USAGE ON SCHEMA public TO %I', r);
  EXECUTE format(
    'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO %I', r);
  EXECUTE format('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO %I', r);

  -- Then take back what evidence tables must never allow.
{revokes}

  -- New tables inherit the same shape, so a future migration cannot quietly
  -- widen the application's rights by adding a table.
  EXECUTE format(
    'ALTER DEFAULT PRIVILEGES IN SCHEMA public '
    'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO %I', r);
  EXECUTE format(
    'ALTER DEFAULT PRIVILEGES IN SCHEMA public '
    'GRANT USAGE, SELECT ON SEQUENCES TO %I', r);
END $$;
"""


def _undo(role: str) -> str:
    return f"""
DO $$
DECLARE r text := {role!r};
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
    RETURN;
  END IF;
  EXECUTE format(
    'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO %I', r);
END $$;
"""


def upgrade() -> None:
    op.execute(_sql(APP_ROLE))


def downgrade() -> None:
    op.execute(_undo(APP_ROLE))
