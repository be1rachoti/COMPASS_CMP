"""Deciding one access question.

Pure functions over the matrix. No I/O, no request object, no framework - which
is what makes the authorisation rules testable without a database and readable
without tracing a dependency chain.

Every function fails closed. An unknown role, an unknown resource, a role with
no row: all deny. There is no path through this module where "I do not
understand the question" produces "yes".
"""

from __future__ import annotations

from dataclasses import dataclass

from cmp.core.permissions import MATRIX, NAV_BY_ROLE, Grant, Role, Scope

_DENY = Grant(Scope.NONE)


@dataclass(frozen=True, slots=True)
class Decision:
    """The answer, and enough of the reasoning to record it.

    Carries `reason` because a denial is written to the audit trail, and
    "denied" without a cause is an entry nobody can act on. An operator reading
    it six months later needs to know whether the role was wrong, the resource
    was unknown, or the grant was read-only.
    """

    allowed: bool
    scope: Scope
    reason: str = ""

    def __bool__(self) -> bool:
        return self.allowed


def _role_of(role: Role | str) -> Role | None:
    try:
        return Role(role)
    except ValueError:
        return None


def grant_for(resource: str, role: Role | str) -> Grant:
    """The grant this role holds on this resource, or a denial.

    The single lookup every other function in this module goes through, so
    there is exactly one place that decides what "absent" means.
    """
    parsed = _role_of(role)
    if parsed is None:
        return _DENY
    return MATRIX.get(resource, {}).get(parsed, _DENY)


def can_read(resource: str, role: Role | str) -> bool:
    return grant_for(resource, role).readable


def can_write(resource: str, role: Role | str) -> bool:
    return grant_for(resource, role).write


def scope_of(resource: str, role: Role | str) -> Scope:
    return grant_for(resource, role).scope


def evaluate(resource: str, role: Role | str, *, write: bool = False) -> Decision:
    """The full answer, with a reason fit for the audit trail."""
    parsed = _role_of(role)
    if parsed is None:
        return Decision(False, Scope.NONE, f"unknown role {role!r}")

    if resource not in MATRIX:
        # Not "no such resource" — that would leak which resources exist to
        # anyone probing. To the caller it is simply denied.
        return Decision(False, Scope.NONE, f"resource {resource!r} is not governed")

    grant = MATRIX[resource].get(parsed, _DENY)
    if not grant.readable:
        return Decision(False, Scope.NONE, f"{parsed.value} has no grant on {resource}")

    if write and not grant.write:
        return Decision(False, grant.scope, f"{parsed.value} has read-only access to {resource}")

    return Decision(True, grant.scope, "")


def nav_for(role: Role | str) -> list[str]:
    """The sections this role may navigate to.

    Returned by `GET /auth/me` and rendered directly by the console, so the
    frontend never holds a second copy of the matrix - and a permission change
    here reaches the UI on the next sign-in rather than the next deploy.
    """
    parsed = _role_of(role)
    if parsed is None:
        return []
    return list(NAV_BY_ROLE.get(parsed, ()))


def readable_resources(role: Role | str) -> list[str]:
    """Everything this role can read. For diagnostics and the security tests."""
    parsed = _role_of(role)
    if parsed is None:
        return []
    return sorted(name for name, row in MATRIX.items() if row.get(parsed, _DENY).readable)


def writable_resources(role: Role | str) -> list[str]:
    parsed = _role_of(role)
    if parsed is None:
        return []
    return sorted(name for name, row in MATRIX.items() if row.get(parsed, _DENY).write)
