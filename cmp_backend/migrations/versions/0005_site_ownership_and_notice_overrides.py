"""Two changes, both about putting a decision where the person making it sits.

**1. A DCO owns sites, not projects.**

Until now `project.dco_user_id` named one DCO per project, and a DCO saw a
project because they were named on it. That models the wrong thing. A Data
Collection Owner is responsible for *places* — the rigs, the campuses, the
partner locations they are accountable for — and a project is simply work that
happens at some of them. Assigning per project meant that every new project
needed somebody to remember who covers Bengaluru, and that moving a site between
owners left the projects behind.

So ownership moves to `project_site.dco_user_id`, and a project's owner is
*derived*: the DCO of its primary site.

`primary` is the site with the lowest `site_id` — the first one registered. That
is a deliberate tie-break rather than a new flag, because the alternative is a
column somebody has to set and will forget, and because the first site is in
practice the one the project was created around.

`project.dco_user_id` is kept, and kept in step by a trigger. It is not
redundant storage for its own sake: the DCO scope predicate is a WHERE clause on
the project list, and resolving "the DCO of the lowest-id active site" inside
that predicate turns every list query into a correlated subquery over two more
tables. The trigger keeps one denormalised column correct so the hot path stays
a single equality — and the trigger, not application code, is what makes it
impossible for the two to disagree.

Sites owned by a *different* DCO still appear on the project. Those DCOs can see
the project and act on their own sites; they are not its owner. That is the
answer to "a project spans three campuses run by three people" without inventing
a co-ownership model nobody asked for.

**2. Rule 3 elements become per-notice.**

`purpose.data_categories` and `purpose.uses` are the Rule 3(b)(i) and 3(b)(ii)
elements, and they live on the purpose — which is global reference data shared
by every notice that attaches it. A DPO drafting a notice for a specific project
could not narrow "the personal data to be collected, itemised" to what *this*
collection actually takes, without editing the shared purpose and changing every
other notice using it.

`notice_purpose` gains nullable overrides. NULL means "use the purpose's", which
is both the default and the common case; a value means this notice says
something narrower. Nullable rather than copied-on-attach on purpose: a copy
would silently freeze the purpose's wording at attach time, so a later
correction to the shared purpose would stop reaching notices that never meant to
diverge.

The override is only ever a *narrowing* — enforced in the service, not here,
because "is this list a subset of that one" is not a CHECK constraint worth
writing in SQL. A notice may not promise less restraint than the purpose it
cites.

Revision ID: 0005
"""

from __future__ import annotations

from alembic import op

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


SITE_OWNERSHIP = """
ALTER TABLE project_site
  ADD COLUMN dco_user_id int REFERENCES auth_user(id);

COMMENT ON COLUMN project_site.dco_user_id IS
  'The DCO accountable for this site. A project''s owner is derived from its '
  'primary (lowest site_id, active) site; see cmp_site_owner_changed().';

CREATE INDEX idx_site_dco ON project_site (dco_user_id) WHERE dco_user_id IS NOT NULL;

-- Existing sites inherit the project's current DCO, so nothing changes hands on
-- deploy. A project with no DCO leaves its sites unowned, which is the same
-- state it was already in.
UPDATE project_site s
   SET dco_user_id = p.dco_user_id
  FROM project p
 WHERE p.project_id = s.project_id
   AND p.dco_user_id IS NOT NULL;
"""


DERIVE_PROJECT_OWNER = """
-- Which site decides. The earliest-registered active site that has an owner.
--
-- One definition, used by the trigger below and by any query that needs to tell
-- a reader *which* of a project's sites is the deciding one. Two copies of this
-- rule would disagree the first time somebody changed the tie-break.
CREATE OR REPLACE FUNCTION cmp_primary_site_id(p_project_id int)
RETURNS int
LANGUAGE sql STABLE AS $$
  SELECT site_id
    FROM project_site
   WHERE project_id = p_project_id
     AND status = 'active'
     AND dco_user_id IS NOT NULL
   ORDER BY site_id
   LIMIT 1;
$$;

COMMENT ON FUNCTION cmp_primary_site_id(int) IS
  'A project''s primary site: the earliest-registered active site that has an '
  'owner. The tie-break is site_id rather than a flag, because a flag is a '
  'thing somebody has to set and will forget.';

-- The primary site's DCO, or NULL when the project has no active owned site.
CREATE OR REPLACE FUNCTION cmp_primary_site_dco(p_project_id int)
RETURNS int
LANGUAGE sql STABLE AS $$
  SELECT dco_user_id FROM project_site
   WHERE site_id = cmp_primary_site_id(p_project_id);
$$;

COMMENT ON FUNCTION cmp_primary_site_dco(int) IS
  'The DCO a project routes to. Derived from cmp_primary_site_id so the two '
  'can never name different sites.';

-- Keeps project.dco_user_id in step with the sites. The column stays because
-- the DCO scope predicate is a WHERE clause on every project list, and a
-- correlated subquery there would cost more than one trigger on a table that
-- changes rarely.
CREATE OR REPLACE FUNCTION cmp_site_owner_changed() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  affected int;
  owner    int;
BEGIN
  affected := COALESCE(NEW.project_id, OLD.project_id);
  owner := cmp_primary_site_dco(affected);

  -- Sites decide only when they have an opinion.
  --
  -- A NULL here means no active site has an owner yet, and that is not the same
  -- as "nobody owns this project". A project can be assigned before any site
  -- exists, and adding an unowned site to it must not quietly orphan it - an
  -- orphaned project is invisible to every DCO, which is a worse failure than a
  -- slightly stale owner and a much quieter one.
  --
  -- The consequence, stated so it is a decision rather than an oversight:
  -- un-assigning the last owned site leaves the project where it was. The
  -- person stays accountable until somebody else takes a site on it.
  IF owner IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  UPDATE project
     SET dco_user_id = owner,
         updated_at  = now()
   WHERE project_id = affected
     AND dco_user_id IS DISTINCT FROM owner;

  RETURN COALESCE(NEW, OLD);
END;
$$;

COMMENT ON FUNCTION cmp_site_owner_changed() IS
  'Re-derives project.dco_user_id when a site is added, reassigned, '
  'deactivated or removed. This is what makes "move the site and the project '
  'follows" true rather than merely intended.';

CREATE TRIGGER trg_site_owner
AFTER INSERT OR UPDATE OF dco_user_id, status, project_id OR DELETE
ON project_site
FOR EACH ROW EXECUTE FUNCTION cmp_site_owner_changed();
"""


NOTICE_RULE3_OVERRIDES = """
ALTER TABLE notice_purpose
  ADD COLUMN data_categories_override text[],
  ADD COLUMN uses_override            text,
  ADD COLUMN overridden_by            int REFERENCES auth_user(id),
  ADD COLUMN overridden_at            timestamptz;

COMMENT ON COLUMN notice_purpose.data_categories_override IS
  'Rule 3(b)(i) for this notice only. NULL means the purpose''s own list, which '
  'is the default and the common case. A value must be a subset of it - a '
  'notice may narrow what is collected, never widen it.';

COMMENT ON COLUMN notice_purpose.uses_override IS
  'Rule 3(b)(ii) for this notice only. NULL means the purpose''s own text.';

-- An override without an author is an override nobody can be asked about.
ALTER TABLE notice_purpose ADD CONSTRAINT override_is_attributed CHECK (
  (data_categories_override IS NULL AND uses_override IS NULL)
  OR (overridden_by IS NOT NULL AND overridden_at IS NOT NULL)
);

-- An empty override is not a narrowing, it is a notice that itemises nothing.
ALTER TABLE notice_purpose ADD CONSTRAINT override_categories_not_empty CHECK (
  data_categories_override IS NULL OR cardinality(data_categories_override) >= 1
);
"""


REVERT_NOTICE_RULE3_OVERRIDES = """
ALTER TABLE notice_purpose DROP CONSTRAINT override_categories_not_empty;
ALTER TABLE notice_purpose DROP CONSTRAINT override_is_attributed;
ALTER TABLE notice_purpose
  DROP COLUMN overridden_at,
  DROP COLUMN overridden_by,
  DROP COLUMN uses_override,
  DROP COLUMN data_categories_override;
"""


REVERT_DERIVE_PROJECT_OWNER = """
DROP TRIGGER IF EXISTS trg_site_owner ON project_site;
DROP FUNCTION IF EXISTS cmp_site_owner_changed();
DROP FUNCTION IF EXISTS cmp_primary_site_dco(int);
DROP FUNCTION IF EXISTS cmp_primary_site_id(int);
"""


REVERT_SITE_OWNERSHIP = """
DROP INDEX IF EXISTS idx_site_dco;
ALTER TABLE project_site DROP COLUMN dco_user_id;
"""


def upgrade() -> None:
    op.execute(SITE_OWNERSHIP)
    op.execute(DERIVE_PROJECT_OWNER)
    op.execute(NOTICE_RULE3_OVERRIDES)


def downgrade() -> None:
    # Reverse order: the trigger reads the column it is dropped before.
    op.execute(REVERT_NOTICE_RULE3_OVERRIDES)
    op.execute(REVERT_DERIVE_PROJECT_OWNER)
    op.execute(REVERT_SITE_OWNERSHIP)
