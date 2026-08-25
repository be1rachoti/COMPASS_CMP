"""Per-request context propagated without threading it through every signature.

The audit layer needs the actor and the source IP on every write. Passing them
down five layers by hand guarantees that one path forgets. Context variables are
task-local, so they are correct under asyncio concurrency and are inherited by
`asyncio.create_task`.
"""

from __future__ import annotations

import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from contextvars import ContextVar, Token
from dataclasses import dataclass, field


@dataclass(frozen=True, slots=True)
class RequestContext:
    request_id: str
    actor_user_id: int | None = None
    actor_uuid: str | None = None
    actor_role: str | None = None
    ip_address: str | None = None
    user_agent: str | None = None
    session_id: str | None = None
    extra: dict[str, str] = field(default_factory=dict)


_EMPTY = RequestContext(request_id="-")
_ctx: ContextVar[RequestContext] = ContextVar("cmp_request_context", default=_EMPTY)


def current_context() -> RequestContext:
    return _ctx.get()


def set_context(ctx: RequestContext) -> Token[RequestContext]:
    return _ctx.set(ctx)


def reset_context(token: Token[RequestContext]) -> None:
    _ctx.reset(token)


def new_request_id() -> str:
    return uuid.uuid4().hex


@contextmanager
def use_context(ctx: RequestContext) -> Iterator[RequestContext]:
    token = _ctx.set(ctx)
    try:
        yield ctx
    finally:
        _ctx.reset(token)


def bind_actor(user_id: int, user_uuid: str, role: str) -> None:
    """Attach the resolved identity once authentication has run."""
    cur = _ctx.get()
    _ctx.set(
        RequestContext(
            request_id=cur.request_id,
            actor_user_id=user_id,
            actor_uuid=user_uuid,
            actor_role=role,
            ip_address=cur.ip_address,
            user_agent=cur.user_agent,
            session_id=cur.session_id,
            extra=cur.extra,
        )
    )
