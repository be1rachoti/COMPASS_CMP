"""The audit trail.

Append-only, hash-chained, and written in the same transaction as the change it
describes - so a change that happened without an audit entry is not a state the
database can reach.

Each row digests its own content plus the digest of the row before it. Editing
row N changes its digest, which no longer matches what N+1 recorded, so
verification does not answer "something changed" but "the trail is sound up to
exactly here".

No update or delete exists at any layer: the route is not registered, the grant
is revoked from the application role, and a trigger refuses the statement. The
Privacy Office is audited by this table, and a DPO who can edit her own audit
trail makes it worthless as evidence.
"""

from cmp.domain.audit.service import (
    Event,
    canonical_detail,
    record,
    record_denial,
    verify_chain,
)

__all__ = ["Event", "canonical_detail", "record", "record_denial", "verify_chain"]
