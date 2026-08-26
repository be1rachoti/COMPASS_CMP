"""Covering for a colleague, without handing over the job.

A DPO goes on leave. A DCO is off for a fortnight and their campuses still
collect. Until now the only way to cover that was to reassign the work — move
the sites, rename the owner — and then remember to move it all back. What people
actually do when that is the only option is share a password, and a shared
password is the end of the audit trail's ability to say who did anything.

So: a **delegation** is a dated, revocable record that one person is covering
for another. It grants the delegate the delegator's row access for as long as it
lasts, and it changes nothing else. Ownership does not move. The sites still
belong to whoever they belonged to, and when the delegation lapses the access
lapses with it — no cleanup step that somebody has to remember.

Three properties are deliberate:

**It is dated, not toggled.** `ends_at` is nullable for open-ended cover, but the
common case is a known return date, and a delegation that expires by itself is
one nobody has to revoke. A toggle is a thing left on.

**It is same-role, enforced in the service.** A DCO may delegate to a DCO. Not
to an R&D User, and not to a DPO — delegation extends what somebody may reach,
and letting it cross roles would make it a privilege-escalation primitive with a
friendly name. The rule is not a CHECK constraint because roles live in
`auth_user` and can change after the fact; the service checks at grant time and
the scope predicate re-checks the role at read time.

**For a DPO it grants nothing, and that is not a bug.** A DPO already reads every
row, so there is no access to extend. The record still matters: it is how the
organisation can answer "who was covering the privacy function that week", which
is a question audits ask and rota spreadsheets answer badly. The API says so
plainly rather than implying an effect it does not have.

Revision ID: 0006
"""

from __future__ import annotations

from alembic import op

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


DELEGATION = """
CREATE TABLE delegation (
  delegation_id     serial PRIMARY KEY,
  delegation_uuid   uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  delegator_user_id int NOT NULL REFERENCES auth_user(id),
  delegate_user_id  int NOT NULL REFERENCES auth_user(id),
  reason            text,
  starts_at         timestamptz NOT NULL DEFAULT now(),
  ends_at           timestamptz,
  revoked_at        timestamptz,
  revoked_by        int REFERENCES auth_user(id),
  created_by        int NOT NULL REFERENCES auth_user(id),
  created_at        timestamptz NOT NULL DEFAULT now(),

  -- Delegating to yourself is a no-op that would still widen nothing and
  -- clutter the record.
  CONSTRAINT not_self CHECK (delegator_user_id <> delegate_user_id),
  CONSTRAINT ends_after_start CHECK (ends_at IS NULL OR ends_at > starts_at),
  -- A revocation without a revoker is a revocation nobody can be asked about.
  CONSTRAINT revocation_is_attributed CHECK (
    (revoked_at IS NULL AND revoked_by IS NULL)
    OR (revoked_at IS NOT NULL AND revoked_by IS NOT NULL))
);

COMMENT ON TABLE delegation IS
  'One person covering another''s row access for a period. Grants, never '
  'transfers: ownership stays where it is and the access lapses on its own.';

-- The lookup on the hot path: "who has delegated to me, right now". Partial,
-- because an expired or revoked delegation is never the answer and there will
-- be far more of those than live ones.
CREATE INDEX idx_delegation_active ON delegation (delegate_user_id, delegator_user_id)
  WHERE revoked_at IS NULL;

CREATE INDEX idx_delegation_by_delegator ON delegation (delegator_user_id);

-- Two live delegations from the same person to the same person is not a
-- meaningful state; it is a double-click. Overlapping periods to *different*
-- people are allowed, because covering two ways at once is real.
CREATE UNIQUE INDEX uq_delegation_live
  ON delegation (delegator_user_id, delegate_user_id)
  WHERE revoked_at IS NULL AND ends_at IS NULL;
"""


ACTIVE_DELEGATES = """
-- Whose rows may this user reach by delegation, right now.
--
-- A function rather than a view so it can be called from inside a WHERE clause
-- with the caller's id, and so the definition of "active" lives in exactly one
-- place: not revoked, started, and not yet ended.
CREATE OR REPLACE FUNCTION cmp_delegators_of(p_user_id int)
RETURNS TABLE (delegator_user_id int)
LANGUAGE sql STABLE AS $$
  SELECT d.delegator_user_id
    FROM delegation d
   WHERE d.delegate_user_id = p_user_id
     AND d.revoked_at IS NULL
     AND d.starts_at <= now()
     AND (d.ends_at IS NULL OR d.ends_at > now());
$$;

COMMENT ON FUNCTION cmp_delegators_of(int) IS
  'The people this user is currently covering for. "Active" is defined here '
  'once - not revoked, started, not ended - so a second definition cannot '
  'drift from it.';
"""


REVERT = """
DROP FUNCTION IF EXISTS cmp_delegators_of(int);
DROP TABLE IF EXISTS delegation;
"""


def upgrade() -> None:
    op.execute(DELEGATION)
    op.execute(ACTIVE_DELEGATES)


def downgrade() -> None:
    op.execute(REVERT)
