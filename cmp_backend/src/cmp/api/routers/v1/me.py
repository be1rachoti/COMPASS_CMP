"""Data subject - /me. 10 endpoints.

Everything here is scoped to the caller by the query, not by a check after the
fact. There is no path by which a data subject reads another subject's record,
because no query here accepts a subject identifier.
"""

from __future__ import annotations

from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, Query, Request
from pydantic import Field

from cmp.api.dependencies import CurrentUser, RequireDataSubject
from cmp.core.errors import Forbidden, NotFound, ValidationFailed
from cmp.db.pool import connection, transaction
from cmp.db.repositories import consent as consent_repo
from cmp.db.repositories import exchange as exchange_repo
from cmp.db.repositories import users as user_repo
from cmp.domain.audit import service as audit
from cmp.domain.audit.service import Event
from cmp.domain.consent import service as consent_service
from cmp.schemas.common import Acknowledged, Mobile, OtpCode, Out, Schema, ShortText

router = APIRouter(prefix="/me", tags=["me"])


class MeProfile(Out):
    uuid: UUID
    full_name: str
    email: str
    mobile: str | None
    organization_id: str | None
    person_type: str | None
    status: str
    created_at: Any


class UpdateMe(Schema):
    full_name: ShortText | None = None
    mobile: Mobile | None = None


class PersonTypeChange(Schema):
    person_type: str
    reason: Annotated[str | None, Field(default=None, max_length=500)] = None


class ContactVerify(Schema):
    contact: Annotated[str, Field(min_length=3, max_length=255)]
    code: OtpCode


class ConsentSummary(Out):
    consent_uuid: UUID
    project_uuid: UUID
    project_name: str
    notice_uuid: UUID
    notice_code: str
    version: int
    language_code: str
    affirmative_action_at: Any
    is_withdrawal: bool
    granted_count: int
    purpose_count: int


class WithdrawRequest(Schema):
    purposes: list[UUID] | None = None
    all: bool = False


@router.get("", response_model=MeProfile)
async def get_me(principal: RequireDataSubject) -> dict[str, Any]:
    async with connection() as conn:
        user = await user_repo.by_id(conn, principal.user_id)
        if not user:
            raise NotFound("Account")
        return user


@router.patch("", response_model=MeProfile)
async def update_me(body: UpdateMe, principal: RequireDataSubject) -> dict[str, Any]:
    async with transaction() as conn:
        updated = await user_repo.update_profile(
            conn,
            principal.user_id,
            full_name=body.full_name,
            mobile=body.mobile,
            organization_id=None,
        )
        await audit.record(
            conn,
            event=Event.USER_UPDATED,
            entity_type="auth_user",
            entity_id=principal.user_id,
            subject_user_id=principal.user_id,
            detail={"self_service": True},
        )
    return updated


@router.post("/contact/verify", response_model=Acknowledged)
async def verify_contact(body: ContactVerify, principal: RequireDataSubject) -> dict[str, Any]:
    from cmp.auth.authentication import otp as otp

    await otp.require(otp.Scope.CONTACT_VERIFY, f"{principal.uuid}:{body.contact}", body.code)
    async with transaction() as conn:
        await user_repo.set_status(conn, principal.user_id, "active")
        await audit.record(
            conn,
            event=Event.OTP_VERIFIED,
            entity_type="auth_user",
            entity_id=principal.user_id,
            subject_user_id=principal.user_id,
            detail={"flow": "contact_verify"},
        )
    return {"ok": True, "message": "Contact verified."}


@router.post("/person-type", response_model=Acknowledged)
async def change_person_type(body: PersonTypeChange, principal: CurrentUser) -> dict[str, Any]:
    """`role` is authorisation, `person_type` is identity.

    They are separate columns because a DPO is *also* an employee. A type change
    must never alter permissions, and this endpoint does not touch `role`.
    """
    from cmp.core.permissions import Role

    valid = {"external", "employee", "ex_employee", "vendor"}
    if body.person_type not in valid:
        raise ValidationFailed("Unknown person type", field="person_type")

    if principal.role not in (Role.DATA_SUBJECT, Role.DPO, Role.ADMIN):
        raise Forbidden("Your role does not permit this action")

    async with transaction() as conn:
        user = await user_repo.by_id(conn, principal.user_id)
        if not user:
            raise NotFound("Account")

        await user_repo.set_person_type(conn, principal.user_id, body.person_type)
        await user_repo.record_person_type_change(
            conn,
            user_id=principal.user_id,
            from_type=user["person_type"],
            to_type=body.person_type,
            reason=body.reason,
            changed_by=principal.user_id,
        )
        await audit.record(
            conn,
            event=Event.USER_PERSON_TYPE_CHANGED,
            entity_type="person_type_history",
            entity_id=principal.user_id,
            subject_user_id=principal.user_id,
            detail={"from": user["person_type"], "to": body.person_type},
        )
    return {"ok": True, "message": "Person type updated. Your permissions are unchanged."}


@router.get("/consents", response_model=list[ConsentSummary])
async def my_consents(principal: RequireDataSubject) -> list[dict[str, Any]]:
    async with connection() as conn:
        return await consent_repo.consents_of_user(conn, principal.user_id)


async def _own_consent(conn: Any, consent_uuid: str, user_id: int) -> dict[str, Any]:
    artefact = await consent_repo.artefact_by_uuid(conn, consent_uuid)
    if not artefact or artefact["auth_user_id"] != user_id:
        # Scope enforced by the ownership test, surfaced as 404.
        raise NotFound("Consent record")
    return artefact


@router.get("/consents/{consent_uuid}")
async def my_consent(consent_uuid: UUID, principal: RequireDataSubject) -> dict[str, Any]:
    async with connection() as conn:
        artefact = await _own_consent(conn, str(consent_uuid), principal.user_id)
        grants = await consent_repo.grants_of(conn, artefact["consent_id"])
        return {
            "consent_uuid": artefact["consent_uuid"],
            "project_name": artefact["project_name"],
            "notice_code": artefact["notice_code"],
            "version": artefact["version"],
            "language_code": artefact["language_code"],
            "site_label": artefact["site_label"],
            "served_at": artefact["served_at"],
            "affirmative_action_at": artefact["affirmative_action_at"],
            "action_type": artefact["action_type"],
            "is_withdrawal": artefact["is_withdrawal"],
            "notice_content_hash": artefact["notice_content_hash"],
            "grants": grants,
        }


@router.get("/consents/{consent_uuid}/notice", summary="The words she actually saw")
async def my_consent_notice(consent_uuid: UUID, principal: RequireDataSubject) -> dict[str, Any]:
    """Reads the copied `notice_content_hash`, not the live notice.

    Joining live to notice_language would let a later correction silently
    repoint her record at words she never saw.
    """
    async with connection() as conn:
        artefact = await _own_consent(conn, str(consent_uuid), principal.user_id)
        served = await consent_repo.served_notice_text(conn, artefact["consent_id"])
        if not served:
            raise NotFound("Notice text")
        return {
            **served,
            "integrity": (
                "verified"
                if served["hash_matches"]
                else "The stored text no longer matches the hash recorded at capture. "
                "Report this to the Privacy Office."
            ),
        }


@router.get("/consents/{consent_uuid}/grants")
async def my_consent_grants(
    consent_uuid: UUID, principal: RequireDataSubject
) -> list[dict[str, Any]]:
    async with connection() as conn:
        artefact = await _own_consent(conn, str(consent_uuid), principal.user_id)
        return await consent_repo.grants_of(conn, artefact["consent_id"])


@router.get("/consents/{consent_uuid}/history", summary="The supersession chain")
async def my_consent_history(
    consent_uuid: UUID, principal: RequireDataSubject
) -> list[dict[str, Any]]:
    """Every grant and withdrawal in order, so she can see the whole sequence."""
    async with connection() as conn:
        artefact = await _own_consent(conn, str(consent_uuid), principal.user_id)
        return await consent_repo.history_chain(
            conn, user_id=principal.user_id, notice_id=artefact["notice_id"]
        )


@router.post("/consents/{consent_uuid}/withdraw")
async def withdraw(
    consent_uuid: UUID,
    body: WithdrawRequest,
    request: Request,
    principal: RequireDataSubject,
) -> dict[str, Any]:
    """Withdraw some purposes or all of them."""
    if not body.all and not body.purposes:
        raise ValidationFailed("Name the purposes to withdraw, or set all", field="purposes")
    async with transaction() as conn:
        return await consent_service.withdraw(
            conn,
            consent_uuid=str(consent_uuid),
            user_id=principal.user_id,
            purpose_uuids=[str(p) for p in (body.purposes or [])],
            withdraw_all=body.all,
            ip_address=request.client.host if request.client else None,
        )


@router.get("/disclosures", summary="Who was my data shared with (s.11(1)(b))")
async def my_disclosures(principal: RequireDataSubject) -> list[dict[str, Any]]:
    """Answered from export_line, not by parsing an archived CSV."""
    async with connection() as conn:
        return await exchange_repo.disclosures_for_user(conn, principal.user_id)


@router.get("/notifications")
async def my_notifications(
    principal: RequireDataSubject,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
) -> dict[str, Any]:
    """Notifications a data subject can see, derived from her own audit trail.

    There is no notifications table in the 22; the events that concern her are
    already recorded, and deriving the feed means it can never disagree with the
    record.
    """
    async with connection() as conn:
        from cmp.db.repositories import audit as audit_repo
        from cmp.db.repositories import entities as entity_repo

        rows = await audit_repo.for_subject(conn, principal.user_id, limit=limit)
        # "What happened to my data" has to name the thing it happened to. The
        # same resolver the DPO's audit trail uses, on the same rows.
        rows = await entity_repo.attach(conn, rows)
    return {"items": rows, "next_cursor": None, "total": len(rows)}
