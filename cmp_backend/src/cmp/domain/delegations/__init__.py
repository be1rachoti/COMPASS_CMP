"""Covering for a colleague.

A delegation grants one person another's row access for a period. It does not
transfer anything: sites keep their owners, projects keep their routing, and
when the delegation lapses the access lapses with it.

The rules live here rather than in the repository because they are decisions
rather than storage, and because getting them wrong turns a convenience into a
privilege-escalation primitive with a friendly name.
"""

from cmp.domain.delegations.service import grant, revoke

__all__ = ["grant", "revoke"]
