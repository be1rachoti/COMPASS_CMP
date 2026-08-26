"""Cover arrangements - 5 endpoints.

A delegation is one person covering another's row access for a period. It grants
and never transfers: sites keep their owners, projects keep their routing, and
the access lapses on its own when the arrangement ends.

There is no PUT. Changing the dates of live cover is a revoke and a new grant,
which is two records of two decisions rather than one record that quietly became
something else — and it is the version an auditor can read.
"""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter
from pydantic import Field

from cmp.api.dependencies import CurrentUser, RequireDPOorAdmin, RequireStaff
from cmp.db.pool import connection, transaction
from cmp.db.repositories import delegations as repo
from cmp.domain.delegations import service
from cmp.schemas.common import Acknowledged, Out, Schema

router = APIRouter(prefix="/delegations", tags=["delegations"])


class DelegationIn(Schema):
    """Who is covering for whom, and until when.

    `delegator_user_uuid` is optional and defaults to the caller: the common
    case is arranging your own cover, and making the caller name themselves is a
    step that only exists to be got wrong. An administrator arranging cover for
    somebody already unreachable names them explicitly.
    """

    delegate_user_uuid: UUID
    delegator_user_uuid: UUID | None = None
    reason: Annotated[str | None, Field(default=None, max_length=1000)] = None
    starts_at: datetime | None = None
    #: Null is open-ended cover. Allowed, because "until further notice" is a
    #: real arrangement, but a known return date is the better one: cover that
    #: expires by itself is cover nobody has to remember to end.
    ends_at: datetime | None = None


class DelegationOut(Out):
    delegation_uuid: UUID
    delegator_uuid: UUID
    delegator_name: str
    delegator_email: str
    delegator_role: str
    delegate_uuid: UUID
    delegate_name: str
    delegate_email: str
    delegate_role: str
    reason: str | None
    starts_at: datetime
    ends_at: datetime | None
    revoked_at: datetime | None
    created_at: datetime
    #: Computed from the dates and the revocation, in one place, so every
    #: surface agrees with the scope predicate about what "active" means.
    is_active: bool


class DelegationGranted(Out):
    delegation_uuid: UUID
    #: False for a DPO: they already read every record, so the arrangement is a
    #: record of who was covering rather than an expansion of access. Said
    #: plainly so the UI does not imply an effect that is not there.
    grants_access: bool
    message: str


@router.post("", response_model=DelegationGranted, status_code=201, summary="Arrange cover")
async def grant(body: DelegationIn, principal: RequireStaff) -> dict[str, Any]:
    """Arrange for somebody to cover your work, in the same role.

    Same role only, and only for yourself unless you are an administrator. Both
    rules are in the service, with the reasoning; the short version is that
    either one relaxed turns this into a way to acquire access rather than a way
    to hand it over.
    """
    async with transaction() as conn:
        return await service.grant(
            conn,
            delegator_uuid=str(body.delegator_user_uuid)
            if body.delegator_user_uuid
            else principal.uuid,
            delegate_uuid=str(body.delegate_user_uuid),
            reason=body.reason,
            starts_at=body.starts_at,
            ends_at=body.ends_at,
            actor_id=principal.user_id,
            actor_role=principal.role,
        )


@router.delete("/{delegation_uuid}", response_model=Acknowledged, summary="End cover now")
async def revoke(delegation_uuid: UUID, principal: RequireStaff) -> dict[str, Any]:
    """Either party may end it, and so may an administrator.

    The delegate as well as the delegator, because being handed access one does
    not want is a real situation and refusing it should not need a ticket.
    """
    async with transaction() as conn:
        return await service.revoke(
            conn,
            delegation_uuid=str(delegation_uuid),
            actor_id=principal.user_id,
            actor_role=principal.role,
        )


@router.get("/mine", response_model=list[DelegationOut], summary="Cover I have arranged")
async def mine(principal: CurrentUser) -> list[dict[str, Any]]:
    """Arrangements where the caller is the one being covered for."""
    async with connection() as conn:
        return await repo.granted_by(conn, principal.user_id)


@router.get("/held", response_model=list[DelegationOut], summary="Cover I am providing")
async def held(principal: CurrentUser) -> list[dict[str, Any]]:
    """Arrangements where the caller is the one covering.

    Worth its own endpoint rather than a filter: "whose work am I answerable for
    this week" is a different question from "who is covering mine", and somebody
    asking it is usually about to act on somebody else's rows.
    """
    async with connection() as conn:
        return await repo.held_by(conn, principal.user_id)


@router.get("", response_model=list[DelegationOut], summary="Every live arrangement")
async def current(principal: RequireDPOorAdmin) -> list[dict[str, Any]]:
    """Who is covering what, right now.

    Restricted to DPO and administrator: it names who is standing in for whom
    across the organisation, which is oversight rather than everyday work.
    """
    async with connection() as conn:
        return await repo.all_current(conn)
