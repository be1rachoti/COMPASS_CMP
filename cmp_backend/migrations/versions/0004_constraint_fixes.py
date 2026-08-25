"""Two defects found by exercising 0001/0002 against a real PostgreSQL.

**1. `categories_not_empty` did not reject an empty array.**

DATA-MODEL.md declares:

    CONSTRAINT categories_not_empty CHECK (array_length(data_categories, 1) >= 1)

`array_length('{}', 1)` returns NULL, not 0. `NULL >= 1` evaluates to NULL, and a
CHECK constraint accepts NULL - it only rejects an explicit false. So the
constraint that exists to enforce Rule 3(b)(i) ("the personal data to be
collected, itemised") admitted a purpose with no items at all. Reproduced:

    INSERT INTO purpose (..., data_categories, ...) VALUES (..., ARRAY[]::text[], ...);
    -- INSERT 0 1

`cardinality()` returns 0 for an empty array, so the comparison is a real
comparison. This is a deliberate deviation from DATA-MODEL.md - that document is
authoritative on *intent*, and the intent is plainly that the list is non-empty.

The same reasoning applies nowhere else in the schema: `data_categories` and
`is_authoritative_for` are the only array columns, and only the former is
required to be non-empty.

**2. `cmp_append_only()` raised the wrong message.**

    format('%s is append-only: % is refused', TG_TABLE_NAME, TG_OP)

A bare `%` is not a valid format specifier, so `format()` itself raised
"unrecognized format() type specifier" before the intended message was built.
The statement was still refused - the exception fired either way, which is why
the enforcement tests passed - but an operator reading the log saw a PostgreSQL
internals error instead of "audit_log is append-only: DELETE is refused". A
guard rail that cannot explain itself gets diagnosed as a bug and disabled.

Revision ID: 0004
"""

from __future__ import annotations

from alembic import op

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


FIX_CATEGORIES = """
-- Any row already stored with an empty list was admitted by the broken check and
-- is not valid under Rule 3(b)(i). Fail loudly rather than silently dropping it:
-- a purpose with no data categories cannot be corrected by guessing.
DO $$
DECLARE bad int;
BEGIN
  SELECT count(*) INTO bad FROM purpose WHERE cardinality(data_categories) = 0;
  IF bad > 0 THEN
    RAISE EXCEPTION
      'Cannot apply 0004: % purpose row(s) have empty data_categories. '
      'Populate them (Rule 3(b)(i) requires itemised categories) and re-run.', bad;
  END IF;
END $$;

ALTER TABLE purpose DROP CONSTRAINT categories_not_empty;
ALTER TABLE purpose ADD CONSTRAINT categories_not_empty
  CHECK (cardinality(data_categories) >= 1);
"""

FIX_APPEND_ONLY_MESSAGE = """
CREATE OR REPLACE FUNCTION cmp_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION
    USING MESSAGE = format('%s is append-only: %s is refused', TG_TABLE_NAME, TG_OP),
          ERRCODE = '42501',
          HINT    = 'Record a new row that supersedes the old one.';
END;
$$;
"""

REVERT_CATEGORIES = """
ALTER TABLE purpose DROP CONSTRAINT categories_not_empty;
ALTER TABLE purpose ADD CONSTRAINT categories_not_empty
  CHECK (array_length(data_categories, 1) >= 1);
"""

REVERT_APPEND_ONLY_MESSAGE = """
CREATE OR REPLACE FUNCTION cmp_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION
    USING MESSAGE = format('%s is append-only: % is refused', TG_TABLE_NAME, TG_OP),
          ERRCODE = '42501';
END;
$$;
"""


def upgrade() -> None:
    op.execute(FIX_CATEGORIES)
    op.execute(FIX_APPEND_ONLY_MESSAGE)


def downgrade() -> None:
    op.execute(REVERT_APPEND_ONLY_MESSAGE)
    op.execute(REVERT_CATEGORIES)
