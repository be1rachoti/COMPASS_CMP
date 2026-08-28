"""A consent link can be shown again.

The original design kept only a keyed digest of the token. The URL was shown
once at mint and was then unrecoverable by anyone, including us, so a stolen
database was worth nothing to an attacker.

That property was given up deliberately, and it is worth being plain about why.
A consent link is handed to a field agent who then goes and collects. When they
lose it, "we cannot tell you, issue a new one" invalidates the link they may
already have shared, and the export written for them carried an identifier they
could not use. The link had to be recoverable to do the job it exists for.

`token_sealed` holds the token encrypted with AES-GCM under a key derived from
the application secret - which lives in the secret manager, not in this
database. So a dump on its own still yields no working links; an attacker now
needs the database *and* the application key, where before the database alone
was useless.

Existing rows get NULL and stay unrecoverable, because their tokens were never
kept and cannot be reconstructed. That is visible rather than silent: the UI
says the link predates this and offers to replace it, and the export leaves the
column empty rather than printing something that will not work.

Revision ID: 0011
"""

from __future__ import annotations

from alembic import op

revision = "0011"
down_revision = "0010"
branch_labels = None
depends_on = None


SEALED = """
ALTER TABLE consent_link ADD COLUMN token_sealed bytea;

COMMENT ON COLUMN consent_link.token_sealed IS
  'The link token, encrypted under a key derived from the application secret. '
  'Lets the URL be shown again to whoever needs to share it. NULL on links '
  'minted before 0011, whose tokens were never kept - those stay unrecoverable '
  'and the interface says so rather than showing a blank link.';

COMMENT ON COLUMN consent_link.token IS
  'Keyed digest of the token, and still the only thing lookups match on. A '
  'request presents a token, it is fingerprinted, and this column is compared - '
  'token_sealed is never used to authenticate, only to re-display.';
"""


REVERT = """
ALTER TABLE consent_link DROP COLUMN token_sealed;
"""


def upgrade() -> None:
    op.execute(SEALED)


def downgrade() -> None:
    # Dropping the column returns every link to being unrecoverable. Nothing is
    # lost that matters: the digest still authenticates, so the links keep
    # working - they simply cannot be shown again.
    op.execute(REVERT)
