"""The authorisation policy, as one object.

Everything above this layer asks its questions here rather than reaching into
the matrix, the evaluator or the role sets directly. That indirection earns its
keep in one specific way: **a denial is recorded**, every time, without the
caller having to remember to record it.

An access-control system that refuses correctly but silently is half a system.
The refusal is the interesting event — it is what tells an operator that
somebody is probing, or that a role was provisioned wrongly, or that a
permission change broke a legitimate workflow. `auth.access_denied` exists for
exactly that, and it is why `authorize()` takes an actor id.
"""

from __future__ import annotations

from cmp.auth.authorization import roles as role_rules
from cmp.auth.authorization.evaluator import (
    Decision,
    can_read,
    can_write,
    evaluate,
    grant_for,
    nav_for,
    scope_of,
)
from cmp.auth.authorization.scopes import ScopeContext
from cmp.core.errors import Forbidden
from cmp.core.logging import get_logger
from cmp.core.permissions import Role, Scope

log = get_logger("cmp.auth.authorization")


def authorize(
    resource: str,
    role: Role | str,
    *,
    write: bool = False,
    user_id: int | None = None,
) -> ScopeContext:
    """Decide, or raise `Forbidden`.

    Returns a `ScopeContext` on success — not a boolean. That is deliberate: the
    caller needs the scope to build its query, and returning it here means the
    permitted call and the row scope are decided in one place from one grant. A
    boolean would leave the caller to look the scope up separately, and the two
    lookups would eventually disagree.

    A denial is logged with the reason before it is raised. The service layer
    turns that into an `auth.access_denied` audit row; the log line is what an
    operator greps when the audit trail is not yet loaded.
    """
    decision = evaluate(resource, role, write=write)

    if not decision.allowed:
        log.warning(
            "authorization.denied",
            resource=resource,
            role=str(role),
            write=write,
            reason=decision.reason,
            user_id=user_id,
        )
        # The message never names why. "You do not have permission" tells a
        # legitimate user to ask their administrator; a specific reason tells
        # somebody probing which door is closest to open.
        raise Forbidden("Your role does not permit this")

    parsed = Role(role)
    return ScopeContext(role=parsed, user_id=user_id or 0, scope=decision.scope)


def require_role(role: Role | str, *allowed: Role) -> Role:
    """A route restricted to named roles rather than to a resource.

    Used where the resource model does not fit — `/auth/mfa/resend` is not about
    a resource, it is about who you are. Kept alongside the resource check so
    both denials log the same way and reach the audit trail by the same path.
    """
    try:
        parsed = Role(role)
    except ValueError:
        log.warning("authorization.denied", reason=f"unknown role {role!r}")
        raise Forbidden("Your role does not permit this") from None

    if parsed not in allowed:
        log.warning(
            "authorization.denied",
            role=parsed.value,
            reason=f"route requires one of {[r.value for r in allowed]}",
        )
        raise Forbidden("Your role does not permit this")

    return parsed


__all__ = [
    "Decision",
    "Role",
    "Scope",
    "ScopeContext",
    "authorize",
    "can_read",
    "can_write",
    "evaluate",
    "grant_for",
    "nav_for",
    "require_role",
    "role_rules",
    "scope_of",
]
