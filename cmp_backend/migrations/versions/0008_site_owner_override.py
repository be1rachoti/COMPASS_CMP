"""A named exception to the derived site owner.

0007 made ownership follow the data source: a site inherits its owner from the
rig deployed at it, so the same rig serving three projects has one owner
recorded once. That is still the rule, and it is still the default.

What it could not express is the ordinary operational case: *this* campus, on
*this* project, is being run by somebody other than whoever normally runs that
rig. Cover, a handover, a study whose partner insists on a named contact. The
only way to say it was to reassign the source - which moved every other project
collecting from it, silently, as a side effect of a decision about one.

So `project_site.dco_override_user_id` is an exception layered over the
derivation, not a second source of truth:

* NULL - and it is NULL for almost every row - means "whoever owns the source",
  which is the answer 0007 gives and the one that stays correct on its own.
* Set means "this site, on this project, is theirs", and it changes nothing
  about the source or about any other project deploying it.

The effective owner is `coalesce(override, source owner)`, and it is computed in
one place: `cmp_primary_site_dco`. Every read goes through that function, so
there is no second definition to drift.

The name says `override` rather than `dco_user_id` deliberately. The column
0005 had was called `dco_user_id` and *was* the answer; a reader who finds this
one must not assume the same, because assuming it would mean writing here
instead of to the source and quietly turning the default off for that site.

Revision ID: 0008
"""

from __future__ import annotations

from alembic import op

revision = "0008"
down_revision = "0007"
branch_labels = None
depends_on = None


OVERRIDE_COLUMN = """
ALTER TABLE project_site
  ADD COLUMN dco_override_user_id int REFERENCES auth_user(id),
  ADD COLUMN dco_override_by      int REFERENCES auth_user(id),
  ADD COLUMN dco_override_at      timestamptz;

COMMENT ON COLUMN project_site.dco_override_user_id IS
  'Who runs this site on this project, when that is not whoever owns its data '
  'source. NULL - the usual case - means the source decides. Setting it changes '
  'nothing about the source or about other projects deploying the same source.';

COMMENT ON COLUMN project_site.dco_override_by IS
  'Who made the exception. An override with no author is an exception nobody '
  'can be asked about, which is the state the audit trail exists to prevent.';

-- An override without an author is an override nobody can be asked about.
ALTER TABLE project_site ADD CONSTRAINT site_override_is_attributed CHECK (
  dco_override_user_id IS NULL
  OR (dco_override_by IS NOT NULL AND dco_override_at IS NOT NULL)
);

CREATE INDEX idx_site_dco_override ON project_site (dco_override_user_id)
  WHERE dco_override_user_id IS NOT NULL;
"""


REDERIVE_OWNER = """
-- The primary site is unchanged in meaning: the earliest-registered active site
-- that has an owner at all. What "has an owner" resolves through is now the
-- coalesce, so a site carrying only an override counts - which is the point of
-- the override, and the alternative would be a site with a named owner that the
-- routing refused to see.
--
-- LEFT JOIN rather than JOIN for the same reason: an override is sufficient on
-- its own, and the inner join would have dropped exactly those rows.
CREATE OR REPLACE FUNCTION cmp_primary_site_id(p_project_id int)
RETURNS int
LANGUAGE sql STABLE AS $$
  SELECT s.site_id
    FROM project_site s
    LEFT JOIN data_source d ON d.source_id = s.source_id
   WHERE s.project_id = p_project_id
     AND s.status = 'active'
     AND coalesce(s.dco_override_user_id, d.owner_user_id) IS NOT NULL
   ORDER BY s.site_id
   LIMIT 1;
$$;

-- The one definition of "who owns this site". Every read resolves through here.
CREATE OR REPLACE FUNCTION cmp_primary_site_dco(p_project_id int)
RETURNS int
LANGUAGE sql STABLE AS $$
  SELECT coalesce(s.dco_override_user_id, d.owner_user_id)
    FROM project_site s
    LEFT JOIN data_source d ON d.source_id = s.source_id
   WHERE s.site_id = cmp_primary_site_id(p_project_id);
$$;

-- The site trigger has to fire on the override too. Without this, naming
-- somebody would record the exception and leave the project pointing at the
-- source's owner - the screen would say one thing and the routing another.
DROP TRIGGER IF EXISTS trg_site_owner ON project_site;
CREATE TRIGGER trg_site_owner
AFTER INSERT OR UPDATE OF source_id, dco_override_user_id, status, project_id OR DELETE
ON project_site
FOR EACH ROW EXECUTE FUNCTION cmp_site_owner_changed();
"""


REVERT = """
DROP TRIGGER IF EXISTS trg_site_owner ON project_site;

CREATE OR REPLACE FUNCTION cmp_primary_site_id(p_project_id int)
RETURNS int LANGUAGE sql STABLE AS $$
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
RETURNS int LANGUAGE sql STABLE AS $$
  SELECT d.owner_user_id
    FROM project_site s
    JOIN data_source d ON d.source_id = s.source_id
   WHERE s.site_id = cmp_primary_site_id(p_project_id);
$$;

CREATE TRIGGER trg_site_owner
AFTER INSERT OR UPDATE OF source_id, status, project_id OR DELETE
ON project_site
FOR EACH ROW EXECUTE FUNCTION cmp_site_owner_changed();

DROP INDEX IF EXISTS idx_site_dco_override;
ALTER TABLE project_site DROP CONSTRAINT IF EXISTS site_override_is_attributed;
ALTER TABLE project_site
  DROP COLUMN dco_override_at,
  DROP COLUMN dco_override_by,
  DROP COLUMN dco_override_user_id;
"""


def upgrade() -> None:
    op.execute(OVERRIDE_COLUMN)
    op.execute(REDERIVE_OWNER)


def downgrade() -> None:
    # Any project routed *only* by an override goes back to its source's owner,
    # which for some rows means no owner at all. Stated rather than silent: the
    # exceptions do not survive, because there is nowhere for them to live.
    op.execute(REVERT)
