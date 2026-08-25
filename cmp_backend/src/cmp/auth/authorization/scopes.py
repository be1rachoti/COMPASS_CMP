"""How far a role can see inside a resource it may call.

The second of the two authorisation questions, and the one that is easy to get
wrong. "May this role call `/projects`?" is answered by the matrix. "Which
projects?" is answered here — and the answer has to become a **WHERE predicate**,
never a filter applied to rows that have already been fetched.

That distinction is the whole point. Hiding a row that is already in the
response is not access control: it is in the response, it went over the wire in
a count, it moved a cursor. The repositories take a scope and build SQL from it,
so a row outside scope is never selected at all.

It is also why this system answers **404 rather than 403** for anything outside
scope. A 403 confirms the row exists, which is exactly the fact the scope was
meant to withhold.
"""

from __future__ import annotations

from dataclasses import dataclass

from cmp.core.permissions import Role, Scope


@dataclass(frozen=True, slots=True)
class ScopeContext:
    """What a repository needs to turn a scope into a predicate.

    Deliberately tiny. A repository that needs more than "who is asking, and how
    far do they see" is deciding permission, which is not its job.
    """

    role: Role
    user_id: int
    scope: Scope

    @property
    def sees_everything(self) -> bool:
        return self.scope is Scope.ALL

    @property
    def sees_nothing(self) -> bool:
        return self.scope is Scope.NONE


#: What each scope means, in the words a reviewer needs. Kept as data because the
#: audit trail records the scope a denial was decided under, and an operator
#: reading that entry should not have to guess what "scoped" meant.
DESCRIPTIONS: dict[Scope, str] = {
    Scope.ALL: "every row of this resource",
    Scope.SCOPED: "rows assigned to this user - for a DCO, projects they are the DCO of",
    Scope.OWN: "rows this user created, or that are about this user",
    Scope.NONE: "no rows",
}

#: Narrowest to widest. Used by `narrower_of`; declared once so the ordering
#: cannot be written down differently in two places.
_ORDER: dict[Scope, int] = {Scope.NONE: 0, Scope.OWN: 1, Scope.SCOPED: 2, Scope.ALL: 3}


def describe(scope: Scope) -> str:
    return DESCRIPTIONS.get(scope, "unknown")


def narrower_of(left: Scope, right: Scope) -> Scope:
    """The more restrictive of two scopes.

    Used where a route carries both a resource grant and an additional
    constraint - a DPO reading `/me` is scoped to her own record whatever the
    matrix says about the `me` resource.

    Combining scopes must always narrow. A helper that could widen one would be
    a privilege escalation with a friendly name.
    """
    return left if _ORDER[left] <= _ORDER[right] else right
