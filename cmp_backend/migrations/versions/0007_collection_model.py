"""The collection model, restated.

Three changes that belong together because each one is incoherent without the
others.

**1. A processor is the entity responsible for collection; sources sit under it.**

Until now a project had no processor at all — it was inferred from whichever
sites happened to exist, which meant an R&D User could not say who would be
collecting until after somebody had registered a site. That is backwards: who
collects is the *first* decision, and the sites follow from it.

So `project_processor` is a real association. A project may name several, and a
processor may serve many projects — the many-to-many is not incidental, a study
running at a partner campus and in-house at once is the ordinary case.

**2. Ownership moves from the site to the data source.**

0005 put `dco_user_id` on `project_site`, on the reasoning that a DCO is
accountable for *places*. That was half right and the wrong half: the place a
DCO is accountable for is the **data source** — the rig, the campus feed, the
capture system — and a project site is where one of those is deployed for one
project. Ownership on the site meant the same rig, used by three projects, had
its owner recorded three times, and nothing stopped those three disagreeing.

`data_source.owner_user_id` is now the single answer, and a site inherits it
through `project_site.source_id`. The project-routing trigger from 0005 still
works and still means the same thing; it now resolves one hop further.

**3. Two new roles.**

* **`dco_admin`** — routes an AIDS-processor project by assigning data sources,
  and holds a DCO's powers across every AIDS project rather than over their own.
* **`rco`** (R&D Collection Owner) — the same accountability for a source the
  R&D team collects itself, where no external processor is involved.

Adding a value to a PostgreSQL enum cannot be undone in a transaction, so the
downgrade below leaves `user_role` alone and says so rather than pretending.

Revision ID: 0007
"""

from __future__ import annotations

from alembic import op

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None


# Enum values have to be added outside a transaction block in older PostgreSQL,
# and committed before anything can reference them. Alembic runs each migration
# in one transaction, so these go first and alone.
NEW_ROLES = """
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'dco_admin';
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'rco';
"""


NOTICE_AUDIENCE = """
CREATE TYPE notice_audience AS ENUM
  ('data_subject', 'employee', 'ex_employee', 'others');

COMMENT ON TYPE notice_audience IS
  'Who a notice is written for. Deliberately separate from person_type: that '
  'records what somebody *is*, this records who a document *addresses*, and '
  'the two answer different questions even where the words overlap.';
"""


IN_HOUSE_PROCESSOR = """
ALTER TABLE processor
  ADD COLUMN is_in_house boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN processor.is_in_house IS
  'Whether this is the organisation collecting for itself. It drives routing: '
  'a project collected by a third party goes to a DCO Admin to be assigned, '
  'one collected in-house goes back to the R&D owner to assign an RCO. '
  'Separate from processor_type, which says what kind of thing a processor is '
  '(lab, tool) and not whose it is - a lab can be either.';

-- Not a CHECK against a name. Hard-coding "SRIB" would put an organisation's
-- current structure into the schema, where renaming a team becomes a
-- migration.
"""


PROJECT_PROCESSORS = """
CREATE TABLE project_processor (
  project_processor_id serial PRIMARY KEY,
  project_id           int NOT NULL REFERENCES project(project_id),
  processor_id         int NOT NULL REFERENCES processor(processor_id),
  added_by             int NOT NULL REFERENCES auth_user(id),
  added_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, processor_id)
);

COMMENT ON TABLE project_processor IS
  'Who will collect for this project. Chosen at creation, before any site '
  'exists, because who collects is the first decision and the sites follow '
  'from it. Many-to-many: a study running at a partner campus and in-house at '
  'once is ordinary, not exceptional.';

CREATE INDEX idx_project_processor_project ON project_processor (project_id);
CREATE INDEX idx_project_processor_processor ON project_processor (processor_id);

-- Existing projects inherit the processors their sites already name, so
-- nothing loses its collector on deploy.
INSERT INTO project_processor (project_id, processor_id, added_by)
SELECT DISTINCT s.project_id, s.processor_id, p.created_by
  FROM project_site s
  JOIN project p ON p.project_id = s.project_id
 WHERE s.processor_id IS NOT NULL
ON CONFLICT DO NOTHING;
"""


SOURCE_OWNERSHIP = """
ALTER TABLE data_source
  ADD COLUMN owner_user_id int REFERENCES auth_user(id);

COMMENT ON COLUMN data_source.owner_user_id IS
  'The DCO or RCO accountable for this source. One answer, here, because the '
  'same rig serving three projects had its owner recorded three times when '
  'this lived on project_site - and nothing stopped those three disagreeing.';

CREATE INDEX idx_source_owner ON data_source (owner_user_id)
  WHERE owner_user_id IS NOT NULL;

-- A site says which source it collects from. The reverse of the old
-- data_source.site_id, which could only ever bind one source to one site and
-- so could not express a rig used by two projects.
ALTER TABLE project_site
  ADD COLUMN source_id int REFERENCES data_source(source_id);

COMMENT ON COLUMN project_site.source_id IS
  'The data source deployed at this site. Ownership is read through it: a '
  'site has no owner of its own.';

CREATE INDEX idx_site_source ON project_site (source_id) WHERE source_id IS NOT NULL;

-- Carry the existing binding across, then carry the owner with it.
UPDATE project_site s
   SET source_id = d.source_id
  FROM data_source d
 WHERE d.site_id = s.site_id;

UPDATE data_source d
   SET owner_user_id = s.dco_user_id
  FROM project_site s
 WHERE s.source_id = d.source_id
   AND s.dco_user_id IS NOT NULL
   AND d.owner_user_id IS NULL;
"""


REDERIVE_OWNER = """
-- The primary site is unchanged in meaning: the earliest-registered active
-- site whose source has an owner. One hop further than 0005, same rule.
CREATE OR REPLACE FUNCTION cmp_primary_site_id(p_project_id int)
RETURNS int
LANGUAGE sql STABLE AS $$
  SELECT s.site_id
    FROM project_site s
    JOIN data_source d ON d.source_id = s.source_id
   WHERE s.project_id = p_project_id
     AND s.status = 'active'
     AND d.owner_user_id IS NOT NULL
   ORDER BY s.site_id
   LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION cmp_primary_site_dco(p_project_id int)
RETURNS int
LANGUAGE sql STABLE AS $$
  SELECT d.owner_user_id
    FROM project_site s
    JOIN data_source d ON d.source_id = s.source_id
   WHERE s.site_id = cmp_primary_site_id(p_project_id);
$$;

-- The trigger now also has to fire when a *source* changes hands, because that
-- is where ownership lives. Without this, reassigning a source would leave
-- every project using it pointing at the previous owner.
CREATE OR REPLACE FUNCTION cmp_source_owner_changed() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  affected int;
  owner    int;
BEGIN
  FOR affected IN
    SELECT DISTINCT s.project_id FROM project_site s WHERE s.source_id = NEW.source_id
  LOOP
    owner := cmp_primary_site_dco(affected);

    IF owner IS NOT NULL THEN
      UPDATE project
         SET dco_user_id = owner, updated_at = now()
       WHERE project_id = affected
         AND dco_user_id IS DISTINCT FROM owner;

    ELSIF OLD.owner_user_id IS NOT NULL THEN
      -- Somebody has just stopped being accountable for this source, and no
      -- other source deployed on the project has an owner either.
      --
      -- The site trigger treats a NULL owner as "no opinion" and leaves the
      -- project where it was, because adding a site nobody runs yet must not
      -- orphan a project. This is a different thing wearing the same NULL: an
      -- explicit relinquishment. Leaving the name on the project would read as
      -- current, and an answer that reads as current is worse than none.
      --
      -- Only where they were the one holding it. A project assigned directly to
      -- somebody else is not theirs to vacate.
      UPDATE project
         SET dco_user_id = NULL, updated_at = now()
       WHERE project_id = affected
         AND dco_user_id = OLD.owner_user_id;
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION cmp_source_owner_changed() IS
  'Re-routes every project collecting from a source when that source changes '
  'hands. The site-level trigger from 0005 covers sites moving between '
  'projects; this covers the source moving between people.';

CREATE TRIGGER trg_source_owner
AFTER UPDATE OF owner_user_id ON data_source
FOR EACH ROW EXECUTE FUNCTION cmp_source_owner_changed();

-- The site trigger now watches source_id too: pointing a site at a different
-- source changes who owns the project.
DROP TRIGGER IF EXISTS trg_site_owner ON project_site;
CREATE TRIGGER trg_site_owner
AFTER INSERT OR UPDATE OF source_id, status, project_id OR DELETE
ON project_site
FOR EACH ROW EXECUTE FUNCTION cmp_site_owner_changed();

-- Ownership has one home now.
ALTER TABLE project_site DROP COLUMN dco_user_id;
"""


NOTICE_FIELDS = """
ALTER TABLE notice
  ADD COLUMN note          text,
  ADD COLUMN applicable_to notice_audience;

COMMENT ON COLUMN notice.note IS
  'A note from the author to whoever collects against this notice. Shown to '
  'the DCO and never to the data principal - it is an instruction to the '
  'collector, not part of the notice they are given.';

COMMENT ON COLUMN notice.applicable_to IS
  'Who this notice addresses. Null on notices that predate the column; the '
  'publish checklist requires it, so nothing reaches a data principal without '
  'it being answered.';
"""


MERGE_DRAFT_STATES = """
-- `in_draft` and `under_process` described one phase: the project is being
-- assembled and has not been submitted. Splitting them put a DPO step in the
-- middle of the R&D User's own work, so a project sat waiting for somebody
-- whose actual job starts at review.
--
-- Every under_process project moves to in_draft. Nothing is lost: the approvals
-- and notices already attached stay attached, and the merged state accepts all
-- of them.
UPDATE project SET project_status = 'in_draft' WHERE project_status = 'under_process';

-- The enum value stays. Removing one from a PostgreSQL enum means recreating
-- the type and every column using it, and the value is now simply unreachable -
-- the state machine names no transition to it. An unreachable value costs
-- nothing; a type rewrite on a live table costs an outage.
COMMENT ON TYPE project_status IS
  'in_draft covers assembly and revision. under_process is retained for '
  'historical rows in project_status_history and is unreachable: no transition '
  'names it. See cmp.domain.projects.state_machine.';
"""


REVERT = """
DROP TRIGGER IF EXISTS trg_source_owner ON data_source;
DROP FUNCTION IF EXISTS cmp_source_owner_changed();

ALTER TABLE project_site ADD COLUMN dco_user_id int REFERENCES auth_user(id);
UPDATE project_site s SET dco_user_id = d.owner_user_id
  FROM data_source d WHERE d.source_id = s.source_id;

CREATE OR REPLACE FUNCTION cmp_primary_site_id(p_project_id int)
RETURNS int LANGUAGE sql STABLE AS $$
  SELECT site_id FROM project_site
   WHERE project_id = p_project_id AND status = 'active' AND dco_user_id IS NOT NULL
   ORDER BY site_id LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION cmp_primary_site_dco(p_project_id int)
RETURNS int LANGUAGE sql STABLE AS $$
  SELECT dco_user_id FROM project_site WHERE site_id = cmp_primary_site_id(p_project_id);
$$;

DROP TRIGGER IF EXISTS trg_site_owner ON project_site;
CREATE TRIGGER trg_site_owner
AFTER INSERT OR UPDATE OF dco_user_id, status, project_id OR DELETE
ON project_site FOR EACH ROW EXECUTE FUNCTION cmp_site_owner_changed();

ALTER TABLE notice DROP COLUMN applicable_to, DROP COLUMN note;
DROP TYPE IF EXISTS notice_audience;

DROP INDEX IF EXISTS idx_site_source;
ALTER TABLE project_site DROP COLUMN source_id;
DROP INDEX IF EXISTS idx_source_owner;
ALTER TABLE data_source DROP COLUMN owner_user_id;

DROP TABLE IF EXISTS project_processor;
ALTER TABLE processor DROP COLUMN is_in_house;

-- user_role keeps 'dco_admin' and 'rco'. Removing an enum value means
-- recreating the type and every column that uses it, which is not something a
-- downgrade should do to a live database on its own initiative.
"""


def upgrade() -> None:
    # Enum additions commit on their own so the values exist for everything
    # below. `IF NOT EXISTS` makes the statement safe to re-run.
    op.execute("COMMIT")
    op.execute(NEW_ROLES)

    op.execute(NOTICE_AUDIENCE)
    op.execute(IN_HOUSE_PROCESSOR)
    op.execute(PROJECT_PROCESSORS)
    op.execute(SOURCE_OWNERSHIP)
    op.execute(REDERIVE_OWNER)
    op.execute(NOTICE_FIELDS)
    op.execute(MERGE_DRAFT_STATES)


def downgrade() -> None:
    op.execute(REVERT)
