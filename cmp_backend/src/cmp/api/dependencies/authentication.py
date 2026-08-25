"""Resolving who is calling.

Three dependencies, and the difference between them is the difference between
three security postures:

* `current_principal` — a full session. Anything else is 401.
* `partial_principal` — a session that has passed the password but not the
  second factor. It authorises exactly one route, the MFA verify endpoint, and
  nothing else. Giving it a name of its own is what stops it being accepted
  where a full session was meant.
* `optional_principal` — for endpoints that behave differently when signed in
  but do not require it. Returns None rather than raising.

None of them decide *permission*. They answer "who is this"; `authorization.py`
answers "may they".
"""

from __future__ import annotations

from typing import Annotated

from fastapi import Depends, Request

from cmp.api.dependencies.sessions import session_from_request
from cmp.auth.identity import Principal
from cmp.core.context import bind_actor
from cmp.core.errors import Forbidden, MfaRequired, Unauthenticated
from cmp.core.permissions import Role


async def current_principal(request: Request) -> Principal:
    """A fully authenticated caller. Partial (pre-MFA) sessions are refused here.

    A partial session authorises exactly one route - `/auth/mfa/verify` - which
    depends on `partial_principal` instead. No other endpoint accepts it.
    """
    session = await session_from_request(request)
    if session.partial:
        raise MfaRequired("Multi-factor verification is required")

    bind_actor(session.user_id, session.user_uuid, session.role)
    return Principal(
        user_id=session.user_id,
        uuid=session.user_uuid,
        role=Role(session.role),
        session=session,
    )


async def partial_principal(request: Request) -> Principal:
    """The half-authenticated caller between password and MFA."""
    session = await session_from_request(request)
    bind_actor(session.user_id, session.user_uuid, session.role)
    return Principal(
        user_id=session.user_id,
        uuid=session.user_uuid,
        role=Role(session.role),
        session=session,
    )


async def optional_principal(request: Request) -> Principal | None:
    """For routes that behave differently when signed in but do not require it."""
    try:
        return await current_principal(request)
    except (Unauthenticated, MfaRequired, Forbidden):
        return None


CurrentUser = Annotated[Principal, Depends(current_principal)]
PartialUser = Annotated[Principal, Depends(partial_principal)]
MaybeUser = Annotated[Principal | None, Depends(optional_principal)]
