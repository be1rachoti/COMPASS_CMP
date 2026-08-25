"""Role model and row scope.

Two separate questions, deliberately kept separate:

1. **May this role call this route at all?** — a static matrix, checked before
   any work is done.
2. **Which rows may this user see?** — a *scope*, which the repository turns into
   a WHERE clause. Never a filter applied to a result set: hiding a row that is
   already in the response is not access control.

`role` is authorisation and `person_type` is identity (DATA-MODEL §Identity).
Nothing here reads person_type — a DPO who becomes an ex-employee keeps her
permissions until someone changes her role.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum


class Role(StrEnum):
    DPO = "dpo"
    DCO = "dco"
    RND_USER = "rnd_user"
    ADMIN = "admin"
    DATA_SUBJECT = "data_subject"


STAFF_ROLES: frozenset[Role] = frozenset({Role.DPO, Role.DCO, Role.RND_USER, Role.ADMIN})
PRIVILEGED_ROLES: frozenset[Role] = frozenset({Role.DPO, Role.ADMIN})


class Scope(StrEnum):
    """How far a role can see within a resource it is permitted to call."""

    ALL = "all"        # every row
    SCOPED = "scoped"  # rows assigned to them (DCO: projects they are DCO of)
    OWN = "own"        # rows they created / that are about them
    NONE = "none"      # no rows


@dataclass(frozen=True, slots=True)
class Grant:
    scope: Scope
    write: bool = False

    @property
    def readable(self) -> bool:
        return self.scope is not Scope.NONE


_DENY = Grant(Scope.NONE)


# Resource -> role -> grant. Derived directly from the API reference permission
# tables. A resource absent from this map is denied to everyone.
MATRIX: dict[str, dict[Role, Grant]] = {
    "user": {
        Role.ADMIN: Grant(Scope.ALL, write=True),
        Role.DPO: Grant(Scope.ALL),          # read-only: DPO sees the register, admin provisions
    },
    "purpose": {
        Role.DPO: Grant(Scope.ALL, write=True),
        Role.ADMIN: Grant(Scope.ALL),
        Role.DCO: Grant(Scope.ALL),
        Role.RND_USER: Grant(Scope.ALL),
    },
    "processor": {
        Role.DPO: Grant(Scope.ALL, write=True),
        Role.ADMIN: Grant(Scope.ALL, write=True),
        Role.DCO: Grant(Scope.ALL),
    },
    "data_source": {
        Role.DPO: Grant(Scope.ALL, write=True),
        Role.ADMIN: Grant(Scope.ALL, write=True),
        Role.DCO: Grant(Scope.ALL),
    },
    "project": {
        Role.DPO: Grant(Scope.ALL, write=True),
        Role.DCO: Grant(Scope.SCOPED, write=True),
        Role.RND_USER: Grant(Scope.OWN, write=True),
    },
    "approval": {
        Role.DPO: Grant(Scope.ALL),
        Role.DCO: Grant(Scope.SCOPED),
        Role.RND_USER: Grant(Scope.OWN, write=True),   # upload proof
    },
    "site": {
        Role.DPO: Grant(Scope.ALL, write=True),
        Role.DCO: Grant(Scope.SCOPED, write=True),
        Role.RND_USER: Grant(Scope.OWN),
    },
    "notice": {
        Role.DPO: Grant(Scope.ALL, write=True),
        Role.DCO: Grant(Scope.SCOPED),
        Role.RND_USER: Grant(Scope.OWN),
    },
    "link": {
        Role.DPO: Grant(Scope.ALL, write=True),
        Role.DCO: Grant(Scope.SCOPED, write=True),
    },
    "consent": {
        Role.DPO: Grant(Scope.ALL),
        Role.DCO: Grant(Scope.SCOPED),
        Role.RND_USER: Grant(Scope.OWN),   # summary counts only, enforced per-route
    },
    "export": {
        Role.DPO: Grant(Scope.ALL, write=True),
        Role.DCO: Grant(Scope.SCOPED, write=True),
    },
    "import": {
        Role.DPO: Grant(Scope.ALL, write=True),
        Role.DCO: Grant(Scope.SCOPED, write=True),
        Role.RND_USER: Grant(Scope.OWN, write=True),
    },
    "collection": {
        Role.DPO: Grant(Scope.ALL),
        Role.DCO: Grant(Scope.SCOPED),
        Role.RND_USER: Grant(Scope.OWN),
    },
    "asset": {
        Role.DPO: Grant(Scope.ALL),
        Role.DCO: Grant(Scope.SCOPED),
        Role.RND_USER: Grant(Scope.OWN),
    },
    # Read-only for the two roles that supervise the platform. No role has write:
    # the route is not registered, the grant is revoked, and a trigger refuses it.
    "audit": {
        Role.DPO: Grant(Scope.ALL),
        Role.ADMIN: Grant(Scope.ALL),
    },
    "me": {
        Role.DATA_SUBJECT: Grant(Scope.OWN, write=True),
    },
}


def grant_for(resource: str, role: Role | str) -> Grant:
    try:
        r = Role(role)
    except ValueError:
        return _DENY
    return MATRIX.get(resource, {}).get(r, _DENY)


def can_read(resource: str, role: Role | str) -> bool:
    return grant_for(resource, role).readable


def can_write(resource: str, role: Role | str) -> bool:
    return grant_for(resource, role).write


def scope_of(resource: str, role: Role | str) -> Scope:
    return grant_for(resource, role).scope


# Navigation the SPA renders on first paint — returned by GET /auth/me so the
# frontend never has to guess, and never has to hold a second copy of the matrix.
NAV_BY_ROLE: dict[Role, tuple[str, ...]] = {
    Role.DPO: (
        "dashboard", "projects", "notices", "purposes", "processors",
        "sources", "consents", "links", "exports", "imports", "audit", "users",
    ),
    Role.DCO: (
        "dashboard", "projects", "sites", "links", "consents",
        "exports", "imports", "collections",
    ),
    Role.RND_USER: ("dashboard", "projects", "approvals", "imports", "collections"),
    Role.ADMIN: ("dashboard", "users", "processors", "sources", "audit"),
    Role.DATA_SUBJECT: ("consents", "notifications", "profile"),
}


def nav_for(role: Role | str) -> list[str]:
    try:
        return list(NAV_BY_ROLE.get(Role(role), ()))
    except ValueError:
        return []
