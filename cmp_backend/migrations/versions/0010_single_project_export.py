"""One export per project, and it is a CSV.

There were two, and the split asked the wrong question of the person using it.

`collection_pack` was JSON: the project, its notice and its purposes, with no
person rows - safe to email, and useless to the agent standing at the collection
point, who needs to know *whom* the consent is against. `consented_list` was the
CSV with the people in it, and carried none of the context saying which notice
version they had agreed to.

So somebody doing the job needed both files and had to join them by hand. One
CSV carries the context on every row instead.

**Per project, not per site.** A project is the thing people talk about; which
of its sites a row came from is a column. `export_log.site_id` therefore becomes
nullable - the older rows keep theirs, and it still means what it meant.

The old enum values stay. `export_log` rows name them, and an export is a
disclosure record: rewriting what it says was disclosed, to tidy a type name,
would be falsifying the one table that exists to be trusted.

Revision ID: 0010
"""

from __future__ import annotations

from alembic import op

revision = "0010"
down_revision = "0009"
branch_labels = None
depends_on = None


NEW_TYPE = """
ALTER TYPE export_type ADD VALUE IF NOT EXISTS 'project_export';
"""


PER_PROJECT = """
ALTER TABLE export_log ALTER COLUMN site_id DROP NOT NULL;

COMMENT ON COLUMN export_log.site_id IS
  'The site this export covered, on the per-site exports that predate 0010. '
  'NULL on a project export, which covers every site the exporter could see - '
  'the rows themselves name their site.';

COMMENT ON TYPE export_type IS
  'project_export is the only reachable value. collection_pack and '
  'consented_list are retained because export_log rows name them, and an '
  'export is a disclosure record: rewriting what it says was disclosed would '
  'falsify the table that exists to be trusted.';
"""


REVERT = """
-- Project exports have no single site, so there is nothing to put back in the
-- column. Removing them is the only way to restore NOT NULL, and they are a
-- disclosure record - so the downgrade refuses rather than deleting them.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM export_log WHERE site_id IS NULL) THEN
    RAISE EXCEPTION
      'Cannot downgrade: % project export(s) have no site. They are disclosure '
      'records and this migration will not delete them.',
      (SELECT count(*) FROM export_log WHERE site_id IS NULL);
  END IF;
END $$;

ALTER TABLE export_log ALTER COLUMN site_id SET NOT NULL;
"""


def upgrade() -> None:
    # An enum value has to be committed before anything can reference it.
    op.execute("COMMIT")
    op.execute(NEW_TYPE)
    op.execute(PER_PROJECT)


def downgrade() -> None:
    op.execute(REVERT)
