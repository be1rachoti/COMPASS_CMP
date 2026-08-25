"""Route guards.

Two shapes, because routes come in two shapes:

* `RequireRole(...)` — this route is for these roles. Used where the resource
  model does not fit: resending an MFA code is not about a resource, it is
  about who you are.
* `RequireResource(name, write=...)` — this route acts on a resource, so the
  permission matrix decides and the caller's row scope comes back with the
  answer.

Both fail closed and both log the denial. A guard that refuses silently is half
an access-control system: the refusal is the event an operator needs — it is
what says somebody is probing, or that a role was provisioned wrongly.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import Depends

from cmp.api.dependencies.authentication import current_principal
from cmp.auth.identity import Principal
from cmp.core.errors import Forbidden
from cmp.core.permissions import Role, Scope, can_write, scope_of


class RequireRole:
    """Role gate for a route.

    Denials are audited by the router that raises them - the dependency itself
    has no database connection, and opening one here would put a write outside
    the transaction the service is about to start.
    """

    def __init__(self, *roles: Role) -> None:
        self.roles = frozenset(roles)

    async def __call__(
        self, principal: Annotated[Principal, Depends(current_principal)]
    ) -> Principal:
        if principal.role not in self.roles:
            raise Forbidden(
                "Your role does not permit this action",
                details={"required": sorted(r.value for r in self.roles)},
            )
        return principal


class RequireResource:
    """Gate on the permission matrix rather than a hardcoded role list.

    Preferred over `RequireRole` wherever the matrix already expresses the rule:
    one definition, and adding a role to a resource does not mean hunting for
    every route that mentions it.
    """

    def __init__(self, resource: str, *, write: bool = False) -> None:
        self.resource = resource
        self.write = write

    async def __call__(
        self, principal: Annotated[Principal, Depends(current_principal)]
    ) -> Principal:
        grant = scope_of(self.resource, principal.role)
        if grant is Scope.NONE:
            raise Forbidden("Your role does not permit this action")
        if self.write and not can_write(self.resource, principal.role):
            raise Forbidden("Your role may read this but not change it")
        return principal
