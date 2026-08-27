"""Users and provisioning - 11 endpoints.

There is no self-registration for staff and no DELETE. Accounts deactivate,
never delete: deleting orphans the audit trail, and an audit row whose actor
cannot be resolved is an audit row that proves nothing.
"""

from __future__ import annotations

from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request, status
from pydantic import EmailStr, Field

from cmp.api.dependencies import (
    Paging,
    RequireAdmin,
    RequireDPOorAdmin,
    RequireStaff,
    reject_unknown_filters,
)
from cmp.auth.sessions import service as sessions
from cmp.core.errors import Conflict, NotFound, ValidationFailed
from cmp.core.pagination import PageRequest
from cmp.core.permissions import Role
from cmp.core.security import hash_password, new_token
from cmp.db.pool import connection, transaction
from cmp.db.repositories import registry as registry_repo
from cmp.db.repositories import users as repo
from cmp.db.sql import unique_violation
from cmp.domain.audit import service as audit
from cmp.domain.audit.service import Event
from cmp.schemas.common import Acknowledged, Mobile, Out, Page, Schema, ShortText

router = APIRouter(prefix="/users", tags=["users"])

user_paging = Paging(repo.LIST_SORTS, "-created_at")


#: Roles that can hold a data source. Ownership is accountability for
#: collection, so it belongs to the people who do it: a DCO for a third party's
#: collection, an RCO for the R&D team's own.
_SOURCE_OWNING_ROLES = frozenset({Role.DCO.value, Role.RCO.value})


class UserOut(Out):
    uuid: UUID
    username: str | None
    full_name: str
    email: str
    mobile: str | None
    organization_id: str | None
    role: str
    person_type: str | None
    status: str
    created_at: Any
    updated_at: Any
    #: Present only on the create response, naming what was assigned in the same
    #: request. The full list lives at `/sources?owner=…`, which stays right as
    #: sources change hands.
    sources: list[str] | None = None


class CreateUser(Schema):
    full_name: ShortText
    email: EmailStr
    role: str
    username: Annotated[str | None, Field(default=None, max_length=120)] = None
    mobile: Mobile | None = None
    organization_id: Annotated[str | None, Field(default=None, max_length=60)] = None
    person_type: str | None = None
    #: The data sources this person will be accountable for, assigned as part of
    #: creating them.
    #:
    #: Here because it is the moment somebody knows the answer. An account
    #: created without sources is a Data Collection Owner who owns nothing, does
    #: not appear in any routing, and is discovered to be idle later - so the
    #: question is asked while the person creating the account still has the
    #: context to answer it.
    #:
    #: Only for the roles that can hold one. A DPO or an administrator owning a
    #: rig would be a category error, and is refused rather than ignored.
    source_uuids: list[UUID] = Field(default_factory=list)


class UpdateUser(Schema):
    full_name: ShortText | None = None
    mobile: Mobile | None = None
    organization_id: Annotated[str | None, Field(default=None, max_length=60)] = None


class RoleChange(Schema):
    role: str
    reason: Annotated[str | None, Field(default=None, max_length=500)] = None


class PersonTypeHistoryOut(Out):
    history_uuid: UUID
    from_type: str | None
    to_type: str
    reason: str | None
    changed_at: Any
    changed_by_uuid: UUID
    changed_by_name: str


class CollectionOwner(Out):
    """Somebody who can be accountable for a data source.

    Four fields, and the role is one of them because it constrains the choice
    rather than merely describing it: an RCO owns in-house collection and a DCO
    a third party's, so the two are not interchangeable.
    """

    uuid: UUID
    full_name: str
    email: str
    role: str


@router.get(
    "/collection-owners",
    response_model=list[CollectionOwner],
    summary="Active DCOs and RCOs, for source ownership",
)
async def collection_owners(principal: RequireStaff) -> list[dict[str, Any]]:
    """The ownership lookup.

    Making somebody accountable for a data source means picking a person, and
    the people who do it - a DCO Admin routing a project, an R&D owner naming an
    RCO - cannot read the account register. Without this the operation is
    unsatisfiable: the form has nothing to offer.

    Scoped to exactly what the choice needs - active DCOs and RCOs, four fields -
    so it is not a way around the register's own restrictions. Declared before
    `/users/{uuid}` so the literal path is matched first.
    """
    async with connection() as conn:
        return await repo.collection_owners(conn)


@router.get("", response_model=Page[UserOut], summary="The staff and subject register")
async def list_users(
    request: Request,
    principal: RequireDPOorAdmin,
    page: Annotated[PageRequest, Depends(user_paging)],
    role: Annotated[str | None, Query()] = None,
    user_status: Annotated[str | None, Query(alias="status")] = None,
    person_type: Annotated[str | None, Query()] = None,
    q: Annotated[str | None, Query(max_length=100)] = None,
) -> dict[str, Any]:
    reject_unknown_filters(request, {"role", "status", "person_type", "q"})
    async with connection() as conn:
        items, cursor, total = await repo.list_users(
            conn, page, role=role, status=user_status, person_type=person_type, q=q
        )
    return {"items": items, "next_cursor": cursor, "total": total}


@router.post("", response_model=UserOut, status_code=status.HTTP_201_CREATED)
async def create_user(body: CreateUser, principal: RequireAdmin) -> dict[str, Any]:
    """Provision a staff account. Administrators only - no self-registration."""
    if body.role not in {r.value for r in Role}:
        raise ValidationFailed("Unknown role", field="role")
    if body.role == Role.DATA_SUBJECT.value:
        raise ValidationFailed(
            "Data subjects register through a consent link, not here", field="role"
        )
    if body.source_uuids and body.role not in _SOURCE_OWNING_ROLES:
        raise ValidationFailed(
            "Only a Data Collection Owner or an R&D Collection Owner can be "
            "accountable for a data source",
            field="source_uuids",
        )

    # A provisioned account starts with a random unusable password and is
    # activated through the reset flow. Emailing an initial password puts a live
    # credential in a mailbox.
    async with transaction() as conn:
        try:
            user = await repo.create(
                conn,
                full_name=body.full_name,
                email=str(body.email),
                role=body.role,
                username=body.username,
                mobile=body.mobile,
                organization_id=body.organization_id,
                person_type=body.person_type,
                status="pending",
                password_hash=hash_password(new_token(32)),
            )
        except Exception as exc:
            if unique_violation(exc):
                raise Conflict(
                    "An account with that email, username or organisation id exists",
                    code="user_exists",
                ) from exc
            raise

        assigned: list[str] = []
        for source_uuid in body.source_uuids:
            source = await registry_repo.source_by_uuid(conn, str(source_uuid))
            if not source:
                raise NotFound("Data source")
            # An in-house source needs an RCO and a third party's needs a DCO.
            # Checked here as well as on the source endpoint because this path
            # writes ownership too, and a rule enforced in one of two places is
            # a rule with a way round it.
            wanted = Role.RCO.value if source.get("is_in_house") else Role.DCO.value
            if body.role != wanted:
                raise ValidationFailed(
                    f"{source['source_code']} is collected "
                    + ("in-house" if source.get("is_in_house") else "by a third party")
                    + f", so a {wanted} is accountable for it",
                    field="source_uuids",
                )
            await registry_repo.set_source_owner(conn, source["source_id"], user["id"])
            assigned.append(source["source_code"])

        await audit.record(
            conn,
            event=Event.USER_CREATED,
            entity_type="auth_user",
            entity_id=user["id"],
            subject_user_id=user["id"],
            detail={"role": body.role, "email": str(body.email), "sources": assigned},
        )
    return {**user, "sources": assigned}


@router.get("/{user_uuid}", response_model=UserOut)
async def get_user(user_uuid: UUID, principal: RequireDPOorAdmin) -> dict[str, Any]:
    async with connection() as conn:
        return await repo.require_by_uuid(conn, str(user_uuid))


@router.patch("/{user_uuid}", response_model=UserOut)
async def update_user(user_uuid: UUID, body: UpdateUser, principal: RequireAdmin) -> dict[str, Any]:
    async with transaction() as conn:
        user = await repo.require_by_uuid(conn, str(user_uuid))
        updated = await repo.update_profile(
            conn,
            user["id"],
            full_name=body.full_name,
            mobile=body.mobile,
            organization_id=body.organization_id,
        )
        await audit.record(
            conn,
            event=Event.USER_UPDATED,
            entity_type="auth_user",
            entity_id=user["id"],
            subject_user_id=user["id"],
            detail={"fields": sorted(k for k, v in body.model_dump().items() if v is not None)},
        )
    return updated


@router.post("/{user_uuid}/role", response_model=Acknowledged, summary="Change a role")
async def change_role(user_uuid: UUID, body: RoleChange, principal: RequireAdmin) -> dict[str, Any]:
    if body.role not in {r.value for r in Role}:
        raise ValidationFailed("Unknown role", field="role")

    async with transaction() as conn:
        user = await repo.require_by_uuid(conn, str(user_uuid))
        if user["role"] == body.role:
            raise Conflict("That user already holds this role", code="role_unchanged")
        if user["id"] == principal.user_id:
            # Self-demotion is how an organisation ends up with no administrator.
            raise Conflict("You cannot change your own role", code="self_role_change")

        await repo.set_role(conn, user["id"], body.role)
        await audit.record(
            conn,
            event=Event.USER_ROLE_CHANGED,
            entity_type="auth_user",
            entity_id=user["id"],
            subject_user_id=user["id"],
            detail={"from": user["role"], "to": body.role, "reason": body.reason},
        )
    # A role change must not leave a session carrying the old role's permissions.
    revoked = await sessions.revoke_all(user["id"])
    return {"ok": True, "message": f"Role changed. {revoked} session(s) terminated."}


@router.post("/{user_uuid}/deactivate", response_model=Acknowledged)
async def deactivate(user_uuid: UUID, principal: RequireAdmin) -> dict[str, Any]:
    async with transaction() as conn:
        user = await repo.require_by_uuid(conn, str(user_uuid))
        if user["id"] == principal.user_id:
            raise Conflict("You cannot deactivate your own account", code="self_deactivate")
        await repo.set_status(conn, user["id"], "deactivated")
        await audit.record(
            conn,
            event=Event.USER_DEACTIVATED,
            entity_type="auth_user",
            entity_id=user["id"],
            subject_user_id=user["id"],
        )
    revoked = await sessions.revoke_all(user["id"])
    return {"ok": True, "message": f"Deactivated. {revoked} session(s) terminated."}


@router.post("/{user_uuid}/reactivate", response_model=Acknowledged)
async def reactivate(user_uuid: UUID, principal: RequireAdmin) -> dict[str, Any]:
    async with transaction() as conn:
        user = await repo.require_by_uuid(conn, str(user_uuid))
        await repo.set_status(conn, user["id"], "active")
        await audit.record(
            conn,
            event=Event.USER_REACTIVATED,
            entity_type="auth_user",
            entity_id=user["id"],
            subject_user_id=user["id"],
        )
    return {"ok": True, "message": "Reactivated."}


@router.delete("/{user_uuid}/sessions", response_model=Acknowledged, summary="Force logout")
async def force_logout(user_uuid: UUID, principal: RequireAdmin) -> dict[str, Any]:
    async with transaction() as conn:
        user = await repo.require_by_uuid(conn, str(user_uuid))
        await audit.record(
            conn,
            event=Event.USER_SESSIONS_REVOKED,
            entity_type="auth_user",
            entity_id=user["id"],
            subject_user_id=user["id"],
            detail={"forced": True},
        )
    revoked = await sessions.revoke_all(user["id"])
    return {"ok": True, "message": f"{revoked} session(s) terminated."}


@router.post("/{user_uuid}/mfa/reset", response_model=Acknowledged)
async def reset_mfa(user_uuid: UUID, principal: RequireAdmin) -> dict[str, Any]:
    from cmp.auth.authentication import otp

    async with transaction() as conn:
        user = await repo.require_by_uuid(conn, str(user_uuid))
        await otp.discard(otp.Scope.STAFF_MFA, str(user_uuid))
        await audit.record(
            conn,
            event=Event.USER_MFA_RESET,
            entity_type="auth_user",
            entity_id=user["id"],
            subject_user_id=user["id"],
        )
    await sessions.revoke_all(user["id"])
    return {"ok": True, "message": "MFA reset. The user must sign in again."}


@router.get("/{user_uuid}/person-type-history", response_model=list[PersonTypeHistoryOut])
async def person_type_history(
    user_uuid: UUID, principal: RequireDPOorAdmin
) -> list[dict[str, Any]]:
    """A type change never creates a second account.

    If an employee becomes a volunteer and gets a new row, her rights requests
    return half her data and nobody notices until she complains.
    """
    async with connection() as conn:
        user = await repo.require_by_uuid(conn, str(user_uuid))
        return await repo.person_type_history(conn, user["id"])
