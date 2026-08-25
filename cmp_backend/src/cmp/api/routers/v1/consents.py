"""Consent links (4) and consent staff views (5).

Staff see consent status and contact details, and no other personal data. Every
status here derives from `v_current_consent`, never from a stored status column -
a denormalised status is a second copy of the truth, and the copy goes stale.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request

from cmp.api.dependencies import Paging, RequireResource, reject_unknown_filters
from cmp.core.errors import Conflict, NotFound
from cmp.core.pagination import PageRequest
from cmp.db.pool import connection, transaction
from cmp.db.repositories import consent as repo
from cmp.db.repositories import projects as project_repo
from cmp.domain import audit
from cmp.domain.audit import Event
from cmp.schemas.common import Acknowledged, Out, Page

router = APIRouter(tags=["consent"])

consent_paging = Paging(repo.LIST_SORTS, "-affirmative_action_at")

LinkReader = Annotated[Any, Depends(RequireResource("link"))]
ConsentReader = Annotated[Any, Depends(RequireResource("consent"))]


class LinkOut(Out):
    link_uuid: UUID
    expires_at: datetime
    max_uses: int | None
    use_count: int
    status: str
    created_at: datetime
    revoked_at: datetime | None = None
    site_uuid: UUID
    site_label: str
    notice_uuid: UUID
    notice_code: str
    version: int


class LinkStats(Out):
    use_count: int
    max_uses: int | None
    uses_remaining: int | None
    registrations: int
    consents: int
    withdrawals: int
    declines: int


class ConsentRow(Out):
    consent_uuid: UUID
    subject_uuid: UUID
    subject_name: str
    subject_email: str
    subject_mobile: str | None
    site_uuid: UUID
    site_label: str
    served_at: datetime
    affirmative_action_at: datetime
    action_type: str
    is_withdrawal: bool
    consent_status: str
    granted_count: int
    refused_count: int


link_paging = Paging(repo.LINK_SORTS, "-created_at")


class LinkListRow(LinkOut):
    project_uuid: UUID
    project_name: str
    registrations: int


class ConsentListRow(ConsentRow):
    project_uuid: UUID
    project_name: str


class ConsentArtefactOut(Out):
    """One consent record, in full.

    Declared rather than returned as a bare dict so `consent_id` - the internal
    surrogate key the scoped query needs for its follow-up lookups - cannot ship
    to a client. An integer primary key in a response body is an invitation to
    enumerate, and it becomes an accidental part of the contract the moment
    somebody reads it off the wire.
    """

    consent_uuid: UUID
    subject_uuid: UUID
    subject_name: str
    subject_email: str
    subject_mobile: str | None
    project_uuid: UUID
    project_name: str
    site_uuid: UUID
    site_label: str
    notice_uuid: UUID
    notice_code: str
    version: int
    language_code: str
    # The evidence trio: what she was shown, when she was shown it, and when she
    # acted. `served_at` is server-stamped; the client never supplies it.
    notice_content_hash: str
    served_at: datetime
    affirmative_action_at: datetime
    action_type: str
    is_withdrawal: bool
    created_at: datetime


class GrantOut(Out):
    purpose_uuid: UUID
    purpose_code: str
    name: str
    description: str
    uses: str
    lawful_basis: str
    data_categories: list[str]
    # A Postgres `interval`, which psycopg hands back as a timedelta and pydantic
    # serialises as an ISO-8601 duration ("P1Y"). Declared as timedelta rather
    # than str so the contract says what the wire actually carries - the client
    # formats it for reading.
    retention_period: timedelta
    granted: bool


class ConsentAssetOut(Out):
    asset_uuid: UUID
    asset_type: str
    source_asset_ref: str
    storage_ref: str
    has_unmapped_subjects: bool
    created_at: datetime
    subject_role: str | None
    disposition: str | None
    disposition_at: datetime | None
    collection_uuid: UUID
    collected_on: date
    source_code: str
    source_name: str
    project_uuid: UUID
    project_name: str


# ===================================================== cross-project listings
@router.get("/links", response_model=Page[LinkListRow], summary="All links in scope")
async def list_all_links(
    request: Request,
    principal: LinkReader,
    page: Annotated[PageRequest, Depends(link_paging)],
    link_status: Annotated[str | None, Query(alias="status")] = None,
) -> dict[str, Any]:
    """Every consent link in scope, with its registration count.

    Registrations are the number that matters operationally: it counts everyone
    who came through the link, including anyone who registered and abandoned
    before consenting, who leaves no artefact to trace.
    """
    reject_unknown_filters(request, {"status"})
    async with connection() as conn:
        items, cursor, total = await repo.list_all_links(
            conn, page, role=principal.role, user_id=principal.user_id, status=link_status
        )
    return {"items": items, "next_cursor": cursor, "total": total}


@router.get("/consents", response_model=Page[ConsentListRow], summary="All consents in scope")
async def list_all_consents(
    request: Request,
    principal: ConsentReader,
    page: Annotated[PageRequest, Depends(consent_paging)],
    consent_status: Annotated[str | None, Query(alias="status")] = None,
    project: Annotated[UUID | None, Query()] = None,
) -> dict[str, Any]:
    """Every current consent in scope. Status is derived, never stored."""
    reject_unknown_filters(request, {"status", "project"})
    async with connection() as conn:
        items, cursor, total = await repo.list_all_consents(
            conn, page,
            role=principal.role, user_id=principal.user_id,
            status=consent_status,
            project_uuid=str(project) if project else None,
        )
    return {"items": items, "next_cursor": cursor, "total": total}


# ==================================================================== links
@router.get("/projects/{project_uuid}/links", response_model=list[LinkOut])
async def list_links(project_uuid: UUID, principal: LinkReader) -> list[dict[str, Any]]:
    async with connection() as conn:
        project = await project_repo.require(
            conn, str(project_uuid), role=principal.role, user_id=principal.user_id
        )
        return await repo.links_for_project(conn, project["project_id"])


@router.get("/links/{link_uuid}", response_model=LinkOut)
async def get_link(link_uuid: UUID, principal: LinkReader) -> dict[str, Any]:
    async with connection() as conn:
        link = await repo.link_by_uuid(
            conn, str(link_uuid), role=principal.role, user_id=principal.user_id
        )
        if not link:
            raise NotFound("Consent link")
        return link


@router.get("/links/{link_uuid}/stats", response_model=LinkStats)
async def link_stats(link_uuid: UUID, principal: LinkReader) -> dict[str, Any]:
    """Opens, registrations, consents, declines and the remaining use cap.

    Registrations counts everyone who came through the link - including anyone
    who registered and abandoned before consenting, who leaves no artefact to
    trace. If a link circulates beyond its intended population, that gap is the
    first sign.
    """
    async with connection() as conn:
        link = await repo.link_by_uuid(
            conn, str(link_uuid), role=principal.role, user_id=principal.user_id
        )
        if not link:
            raise NotFound("Consent link")
        return await repo.link_stats(conn, link["link_id"])


@router.post("/links/{link_uuid}/revoke", response_model=Acknowledged)
async def revoke_link(link_uuid: UUID, principal: LinkReader) -> dict[str, Any]:
    async with transaction() as conn:
        link = await repo.link_by_uuid(
            conn, str(link_uuid), role=principal.role, user_id=principal.user_id
        )
        if not link:
            raise NotFound("Consent link")
        revoked = await repo.revoke_link(conn, link["link_id"], principal.user_id)
        if not revoked:
            raise Conflict("That link is not active", code="link_not_active")
        await audit.record(
            conn, event=Event.LINK_REVOKED, entity_type="consent_link",
            entity_id=link["link_id"],
        )
    return {"ok": True, "message": "Link revoked. It no longer resolves."}


# ========================================================== staff consent views
@router.get("/projects/{project_uuid}/consents", response_model=Page[ConsentRow])
async def list_consents(
    project_uuid: UUID,
    request: Request,
    principal: ConsentReader,
    page: Annotated[PageRequest, Depends(consent_paging)],
    site: Annotated[UUID | None, Query()] = None,
    consent_status: Annotated[str | None, Query(alias="status")] = None,
    date_from: Annotated[datetime | None, Query(alias="from")] = None,
    date_to: Annotated[datetime | None, Query(alias="to")] = None,
) -> dict[str, Any]:
    reject_unknown_filters(request, {"site", "status", "from", "to"})
    async with connection() as conn:
        project = await project_repo.require(
            conn, str(project_uuid), role=principal.role, user_id=principal.user_id
        )
        items, cursor, total = await repo.list_for_project(
            conn, page,
            project_id=project["project_id"],
            site_uuid=str(site) if site else None,
            status=consent_status,
            date_from=date_from,
            date_to=date_to,
        )
    return {"items": items, "next_cursor": cursor, "total": total}


@router.get("/projects/{project_uuid}/consents/summary")
async def consents_summary(project_uuid: UUID, principal: ConsentReader) -> dict[str, Any]:
    async with connection() as conn:
        project = await project_repo.require(
            conn, str(project_uuid), role=principal.role, user_id=principal.user_id
        )
        return await project_repo.consent_counts(conn, project["project_id"])


@router.get("/consents/{consent_uuid}", response_model=ConsentArtefactOut)
async def get_consent(consent_uuid: UUID, principal: ConsentReader) -> dict[str, Any]:
    async with connection() as conn:
        artefact = await repo.artefact_scoped(
            conn, str(consent_uuid), role=principal.role, user_id=principal.user_id
        )
        if not artefact:
            raise NotFound("Consent record")
        return artefact


@router.get("/consents/{consent_uuid}/grants", response_model=list[GrantOut])
async def consent_grants(
    consent_uuid: UUID, principal: ConsentReader
) -> list[dict[str, Any]]:
    async with connection() as conn:
        artefact = await repo.artefact_scoped(
            conn, str(consent_uuid), role=principal.role, user_id=principal.user_id
        )
        if not artefact:
            raise NotFound("Consent record")
        return await repo.grants_of(conn, artefact["consent_id"])


@router.get(
    "/consents/{consent_uuid}/assets",
    response_model=list[ConsentAssetOut],
    summary="Which assets contain this person",
)
async def consent_assets(
    consent_uuid: UUID, principal: ConsentReader
) -> list[dict[str, Any]]:
    """The reverse lookup an erasure request depends on.

    It is the reason `asset_consent` exists: without it, "delete everything of
    mine" has no way to find the frames she appears in.
    """
    async with connection() as conn:
        artefact = await repo.artefact_scoped(
            conn, str(consent_uuid), role=principal.role, user_id=principal.user_id
        )
        if not artefact:
            raise NotFound("Consent record")
        return await repo.assets_for_consent(conn, artefact["consent_id"])
