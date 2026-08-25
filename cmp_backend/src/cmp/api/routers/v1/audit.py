"""Audit - 3 endpoints, all reads.

No mutating verb exists on this resource for any role. Not hidden - absent. The
route is not registered here, the grant is revoked from the application role
(migration 0003), and a database trigger refuses the statement (migration 0002).

The Privacy Office is audited by this table. A DPO who can edit her own audit
trail makes it worthless as evidence.
"""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request

from cmp.api.dependencies import Paging, RequireDPOorAdmin, reject_unknown_filters
from cmp.core.errors import NotFound
from cmp.core.pagination import PageRequest
from cmp.db.pool import connection
from cmp.db.repositories import audit as repo
from cmp.db.repositories import entities as entity_repo
from cmp.domain.audit import service as audit_service
from cmp.schemas.common import Out, Page

router = APIRouter(prefix="/audit", tags=["audit"])

audit_paging = Paging(repo.LIST_SORTS, "-occurred_at")


class AuditEntry(Out):
    log_uuid: UUID
    event_type: str
    entity_type: str
    entity_id: int
    occurred_at: datetime
    detail: dict[str, Any] | None = None
    actor_uuid: UUID | None = None
    actor_name: str | None = None
    actor_role: str | None = None
    subject_uuid: UUID | None = None
    subject_name: str | None = None

    # The trail records `notice#42` because that reference stays valid forever.
    # These four turn it into something a person can read and click, resolved at
    # read time so a rename shows the current name rather than a stale copy.
    # They are null where the row has since been deleted - the trail outlives
    # what it describes, and that is the point of it.
    entity_uuid: str | None = None
    entity_label: str | None = None
    entity_noun: str | None = None
    entity_href: str | None = None


class VerifyResult(Out):
    intact: bool
    rows_checked: int
    last_log_id: int | None
    first_break: dict[str, Any] | None
    message: str


@router.get("", response_model=Page[AuditEntry], summary="Search the trail")
async def search(
    request: Request,
    principal: RequireDPOorAdmin,
    page: Annotated[PageRequest, Depends(audit_paging)],
    actor: Annotated[UUID | None, Query()] = None,
    subject: Annotated[UUID | None, Query()] = None,
    entity_type: Annotated[str | None, Query(max_length=60)] = None,
    entity_id: Annotated[int | None, Query(ge=1)] = None,
    event_type: Annotated[str | None, Query(max_length=80)] = None,
    date_from: Annotated[datetime | None, Query(alias="from")] = None,
    date_to: Annotated[datetime | None, Query(alias="to")] = None,
) -> dict[str, Any]:
    reject_unknown_filters(
        request, {"actor", "subject", "entity_type", "entity_id", "event_type", "from", "to"}
    )
    async with connection() as conn:
        items, cursor, total = await repo.search(
            conn,
            page,
            actor_uuid=str(actor) if actor else None,
            subject_uuid=str(subject) if subject else None,
            entity_type=entity_type,
            entity_id=entity_id,
            event_type=event_type,
            date_from=date_from,
            date_to=date_to,
        )
        # One query per entity type on the page, not one per row.
        items = await entity_repo.attach(conn, items)
    return {"items": items, "next_cursor": cursor, "total": total}


@router.get("/verify", response_model=VerifyResult, summary="Verify the hash chain")
async def verify(
    principal: RequireDPOorAdmin,
    from_log_id: Annotated[int, Query(ge=0)] = 0,
) -> dict[str, Any]:
    """Recompute the chain and report the first row that does not verify.

    Every row carries a digest over its own content and its predecessor's digest.
    Editing row N changes its digest, which no longer matches what N+1 recorded,
    so the answer is not "something changed" but "the trail is sound up to
    exactly here".
    """
    async with connection() as conn:
        result = await audit_service.verify_chain(conn, from_log_id=from_log_id)

    if result["intact"]:
        message = f"Chain intact across {result['rows_checked']} rows."
    else:
        brk = result["first_break"]
        message = (
            f"Chain broken at log {brk['log_id']} ({brk['occurred_at']}): {brk['reason']}. "
            "Rows before this point still verify."
        )
    return {**result, "message": message}


@router.get("/{log_uuid}", response_model=AuditEntry)
async def get_entry(log_uuid: UUID, principal: RequireDPOorAdmin) -> dict[str, Any]:
    async with connection() as conn:
        entry = await repo.by_uuid(conn, str(log_uuid))
        if not entry:
            raise NotFound("Audit entry")
        (enriched,) = await entity_repo.attach(conn, [entry])
        return enriched
