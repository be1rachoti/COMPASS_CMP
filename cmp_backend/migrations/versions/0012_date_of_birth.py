"""A data principal's date of birth.

Added for one reason, and it is worth being explicit about it: section 9 of the
DPDP Act treats a person under eighteen as a child, and processing a child's
personal data requires verifiable consent from a parent or lawful guardian. A
platform that records consent cannot tell whether it has that obligation without
knowing how old the person is.

`dob` is therefore not a profile decoration. It is the input to whether an
account is a child's account, which is why `cmp_is_minor()` lives here as a
function rather than being computed in three places in Python and disagreeing on
the day somebody has a birthday.

**Nullable, deliberately.** Every account that exists today was created through a
consent link that never asked, and there is no honest value to backfill - a
guessed date of birth on a record that decides whether parental consent was
required would be worse than an absent one. New self-registrations must supply
it; the API enforces that, and this column records what is known rather than
pretending to know more.

Revision ID: 0012
"""

from __future__ import annotations

from alembic import op

revision = "0012"
down_revision = "0011"
branch_labels = None
depends_on = None


DOB = """
ALTER TABLE auth_user ADD COLUMN dob date;

-- A date of birth that is in the future, or implies an age no person has
-- reached, is a typo rather than a fact. Caught here because the column feeds a
-- statutory test, and a 1902 birth date silently making somebody an adult is
-- exactly the failure this is meant to prevent.
ALTER TABLE auth_user ADD CONSTRAINT dob_is_plausible CHECK (
  dob IS NULL OR (dob > DATE '1900-01-01' AND dob < CURRENT_DATE)
);

COMMENT ON COLUMN auth_user.dob IS
  'Date of birth. Drives the section 9 test for whether this is a child''s '
  'account. NULL on accounts created before 0012 and on any account registered '
  'through a consent link, which does not ask - absent, not assumed adult.';

-- One definition of the age test, so the API, a report and a future retention
-- sweep cannot disagree about who is a child.
--
-- STABLE rather than IMMUTABLE: the answer depends on CURRENT_DATE, so it must
-- not be inlined into an index. A person becomes an adult without their row
-- being written to, and an index built on this would still say child.
CREATE OR REPLACE FUNCTION cmp_is_minor(birth date)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT CASE
    WHEN birth IS NULL THEN NULL
    ELSE birth > (CURRENT_DATE - INTERVAL '18 years')
  END;
$$;

COMMENT ON FUNCTION cmp_is_minor(date) IS
  'True when the date of birth is under eighteen years ago. NULL when unknown - '
  'which is not the same as false, and callers must not treat it as adult.';
"""


REVERT = """
DROP FUNCTION IF EXISTS cmp_is_minor(date);
ALTER TABLE auth_user DROP CONSTRAINT IF EXISTS dob_is_plausible;
ALTER TABLE auth_user DROP COLUMN dob;
"""


def upgrade() -> None:
    op.execute(DOB)


def downgrade() -> None:
    # Dropping the column discards every date of birth recorded since 0012.
    # Nothing else breaks - the column is read, never joined on - but the
    # information is gone, and a re-upgrade starts empty.
    op.execute(REVERT)
