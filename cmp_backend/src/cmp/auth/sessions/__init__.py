"""Server-side sessions.

In Redis, never in a JWT. The difference that matters: a session held server-side
can be revoked and is gone on the next request; a signed token cannot be, and
"sign out everywhere" becomes a promise the system cannot keep.

A *partial* session exists between password verification and MFA. It authorises
exactly one route — the verify endpoint — and every other endpoint answers 401
with `mfa_required` until it is promoted.
"""

from cmp.auth.sessions.service import (
    Session,
    create,
    destroy,
    list_for_user,
    load,
    promote,
    revoke_all,
    revoke_by_sid,
)

__all__ = [
    "Session",
    "create",
    "destroy",
    "list_for_user",
    "load",
    "promote",
    "revoke_all",
    "revoke_by_sid",
]
