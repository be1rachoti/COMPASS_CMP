"""Scheduled work.

Four jobs, each on its own cadence, each idempotent because `acks_late` means any
of them can be redelivered.

None of them are interactive, so they all route to the `default` queue — a
retention sweep that delays an MFA code would be a self-inflicted outage, which
is why the codes have a queue of their own.
"""

from cmp.tasks.maintenance.assets import flag_unmapped_assets
from cmp.tasks.maintenance.audit import verify_audit_chain
from cmp.tasks.maintenance.consent_links import expire_consent_links
from cmp.tasks.maintenance.retention import apply_retention_lapse

__all__ = [
    "apply_retention_lapse",
    "expire_consent_links",
    "flag_unmapped_assets",
    "verify_audit_chain",
]
