"""Request dependencies: identity, CSRF, role guards, paging.

This is the only place that turns a cookie into a user. Routes declare what they
need (`CurrentUser`, `RequireDPO`, ...) and get a resolved, checked principal or
an error - they never inspect a cookie themselves.

A note on what these guards do *not* do. They answer "may this role call this
route". They do not answer "may this user see this row" - that is a scope, and it
belongs in the WHERE clause of the query, not in a decorator. Hiding a row that
is already in the response is not access control.
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass
from typing import Annotated, Any

from fastapi import Depends, Query, Request

from cmp.core.config import settings
from cmp.core.context import bind_actor
from cmp.core.errors import Forbidden, MfaRequired, Unauthenticated
from cmp.core.pagination import PageRequest, parse_page
from cmp.core.permissions import Role, Scope, scope_of
from cmp.core.security import csrf_matches
from cmp.domain import sessions
from cmp.domain.sessions import Session

# Verbs that change state must present the CSRF header. Safe verbs must not need
# it - requiring it on GET breaks every link a browser can follow.
_UNSAFE_METHODS = frozenset({"POST", "PUT", "PATCH", "DELETE"})


@dataclass(frozen=True, slots=True)
class Principal:
    """The authenticated caller, resolved once per request."""

    user_id: int
    uuid: str
    role: Role
    session: Session

    def scope_for(self, resource: str) -> Scope:
        return scope_of(resource, self.role)

    @property
    def is_staff(self) -> bool:
        return self.role is not Role.DATA_SUBJECT


async def _session_from_request(request: Request) -> Session:
    token = request.cookies.get(settings.cookie_name)
    if not token:
        raise Unauthenticated("Sign in to continue")

    session = await sessions.load(token)
    if session is None:
        raise Unauthenticated("Your session has expired")

    # Double-submit CSRF. Checked here rather than in middleware because it needs
    # the session's own token, and because safe methods must be exempt.
    if request.method in _UNSAFE_METHODS:
        header = request.headers.get(settings.csrf_header_name)
        if not csrf_matches(session.csrf_token, header):
            raise Forbidden("Missing or invalid CSRF token", code="csrf_failed")

    return session


async def current_principal(request: Request) -> Principal:
    """A fully authenticated caller. Partial (pre-MFA) sessions are refused here.

    A partial session authorises exactly one route - `/auth/mfa/verify` - which
    depends on `partial_principal` instead. No other endpoint accepts it.
    """
    session = await _session_from_request(request)
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
    session = await _session_from_request(request)
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


class RequireRole:
    """Role gate for a route.

    Denials are audited by the router that raises them - the dependency itself
    has no database connection, and opening one here would put a write outside
    the transaction the service is about to start.
    """

    def __init__(self, *roles: Role) -> None:
        self.roles = frozenset(roles)

    async def __call__(self, principal: CurrentUser) -> Principal:
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

    async def __call__(self, principal: CurrentUser) -> Principal:
        grant = scope_of(self.resource, principal.role)
        if grant is Scope.NONE:
            raise Forbidden("Your role does not permit this action")
        if self.write:
            from cmp.core.permissions import can_write

            if not can_write(self.resource, principal.role):
                raise Forbidden("Your role may read this but not change it")
        return principal


RequireDPO = Annotated[Principal, Depends(RequireRole(Role.DPO))]
RequireAdmin = Annotated[Principal, Depends(RequireRole(Role.ADMIN))]
RequireDPOorAdmin = Annotated[Principal, Depends(RequireRole(Role.DPO, Role.ADMIN))]
RequireStaff = Annotated[
    Principal, Depends(RequireRole(Role.DPO, Role.DCO, Role.RND_USER, Role.ADMIN))
]
RequireDataSubject = Annotated[Principal, Depends(RequireRole(Role.DATA_SUBJECT))]


# ------------------------------------------------------------------- paging
class Paging:
    """Validated cursor paging for one route's allow-list of sort fields.

    The allow-list is per route because the sort column is interpolated into SQL.
    A shared list would eventually contain a column some table does not have.
    """

    def __init__(self, allowed_sorts: Iterable[str], default_sort: str) -> None:
        self.allowed = tuple(allowed_sorts)
        self.default = default_sort

    async def __call__(
        self,
        limit: Annotated[int | None, Query(ge=1, le=settings.max_page_size)] = None,
        cursor: Annotated[str | None, Query(max_length=512)] = None,
        sort: Annotated[str | None, Query(max_length=64)] = None,
    ) -> PageRequest:
        return parse_page(
            limit=limit,
            cursor=cursor,
            sort=sort,
            allowed_sorts=self.allowed,
            default_sort=self.default,
        )


def reject_unknown_filters(request: Request, known: Iterable[str]) -> None:
    """Unknown query parameters are a 400, never ignored.

    A typo in a filter that silently returns everything is how the wrong people
    see the wrong rows (API reference §1.3).
    """
    from cmp.core.errors import UnknownFilter

    permitted = set(known) | {"limit", "cursor", "sort"}
    unknown = sorted(set(request.query_params) - permitted)
    if unknown:
        raise UnknownFilter(
            f"Unknown query parameter(s): {', '.join(unknown)}",
            field=unknown[0],
            details={"allowed": sorted(permitted)},
        )


def set_session_cookies(response: Any, token: str, csrf_token: str, *, max_age: int) -> None:
    """Two cookies, deliberately different.

    The session cookie is HttpOnly so script cannot read it. The CSRF cookie must
    be readable by script - that is the whole mechanism: the page reads it and
    echoes it in a header, which a cross-origin page cannot do.
    """
    response.set_cookie(
        settings.cookie_name,
        token,
        max_age=max_age,
        httponly=True,
        secure=settings.cookie_secure,
        samesite=settings.cookie_samesite,
        domain=settings.cookie_domain,
        path="/",
    )
    response.set_cookie(
        settings.csrf_cookie_name,
        csrf_token,
        max_age=max_age,
        httponly=False,
        secure=settings.cookie_secure,
        samesite=settings.cookie_samesite,
        domain=settings.cookie_domain,
        path="/",
    )


def clear_session_cookies(response: Any) -> None:
    for name in (settings.cookie_name, settings.csrf_cookie_name):
        response.delete_cookie(
            name,
            domain=settings.cookie_domain,
            path="/",
            secure=settings.cookie_secure,
            samesite=settings.cookie_samesite,
        )
