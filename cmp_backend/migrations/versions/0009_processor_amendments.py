"""Adding a collector to a project that is already approved.

Until now the set of processors was fixed at approval and could not be changed
afterwards at all. That was the right refusal - an approved project collecting
through an organisation the DPO never reviewed is the thing this system exists
to prevent - but it left no way to do a legitimate and ordinary thing: a study
expands to a second partner campus six months in.

The wrong fix is to send the whole project back for review. Collection is live
at its existing sites, consent is being taken there, and suspending all of it to
add somewhere else punishes the parts that were never in question.

So the amendment is scoped to the one thing that changed. `project_processor`
carries its own status:

* **pending** - the R&D User has asked. The processor is on the project's list
  but counts for nothing: no site may deploy its sources, and the routing does
  not see it.
* **approved** - the DPO has agreed. Only now does it become one of "the
  project's processors", and only now can collection be set up under it.
* **rejected** - the DPO has refused, with a reason. Kept rather than deleted,
  because "we asked and were told no" is a fact somebody will need, and a row
  that vanishes takes the reason with it.

Everything that already exists is `approved`: those rows were part of what the
DPO reviewed when they approved the project.

The decision columns mirror the pattern the notice overrides use - who, when,
and why - and the CHECK holds them to it, because a refusal nobody can be asked
about is the state the audit trail exists to prevent.

Revision ID: 0009
"""

from __future__ import annotations

from alembic import op

revision = "0009"
down_revision = "0008"
branch_labels = None
depends_on = None


AMENDMENT_STATUS = """
CREATE TYPE processor_request_status AS ENUM ('pending', 'approved', 'rejected');

COMMENT ON TYPE processor_request_status IS
  'Where a project-to-processor link stands. Only ''approved'' counts as one of '
  'the project''s processors - a pending one is a request, not a collector.';

ALTER TABLE project_processor
  ADD COLUMN status          processor_request_status NOT NULL DEFAULT 'approved',
  ADD COLUMN decided_by      int REFERENCES auth_user(id),
  ADD COLUMN decided_at      timestamptz,
  ADD COLUMN decision_reason text;

COMMENT ON COLUMN project_processor.status IS
  'Added while the project was in draft, or approved as an amendment: '
  '''approved''. Requested against an already-approved project and not yet '
  'decided: ''pending''. Refused: ''rejected'', with the reason kept.';

COMMENT ON COLUMN project_processor.decision_reason IS
  'Why the DPO refused. Required on a rejection - "no" without a reason is a '
  'decision the R&D User cannot act on, so they ask again and get it again.';

-- Every existing row predates this and was part of what the DPO approved.
-- The DEFAULT above already did it; stated so the intent is not inferred from
-- a default that somebody might later change.
UPDATE project_processor SET status = 'approved' WHERE status IS DISTINCT FROM 'approved';

-- A refusal nobody can be asked about is the state the audit trail prevents.
ALTER TABLE project_processor ADD CONSTRAINT processor_rejection_has_a_reason CHECK (
  status <> 'rejected'
  OR (decided_by IS NOT NULL AND decided_at IS NOT NULL
      AND coalesce(length(trim(decision_reason)), 0) > 0)
);

ALTER TABLE project_processor ADD CONSTRAINT processor_decision_is_attributed CHECK (
  status = 'pending' OR decided_at IS NULL OR decided_by IS NOT NULL
);

-- The DPO's queue: what is waiting on them, across every project.
CREATE INDEX idx_project_processor_pending ON project_processor (project_id)
  WHERE status = 'pending';
"""


REVERT = """
DROP INDEX IF EXISTS idx_project_processor_pending;
ALTER TABLE project_processor DROP CONSTRAINT IF EXISTS processor_decision_is_attributed;
ALTER TABLE project_processor DROP CONSTRAINT IF EXISTS processor_rejection_has_a_reason;

-- A pending request is not a collector and a rejected one was refused, so
-- neither may survive as an ordinary link - which is what dropping the column
-- would turn them into.
DELETE FROM project_processor WHERE status <> 'approved';

ALTER TABLE project_processor
  DROP COLUMN decision_reason,
  DROP COLUMN decided_at,
  DROP COLUMN decided_by,
  DROP COLUMN status;

DROP TYPE IF EXISTS processor_request_status;
"""


def upgrade() -> None:
    op.execute(AMENDMENT_STATUS)


def downgrade() -> None:
    op.execute(REVERT)
