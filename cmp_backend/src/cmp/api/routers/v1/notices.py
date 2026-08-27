"""Notices - the R&D User authors, the DPO reviews and may correct, all roles read.

`/checklist` returns exactly what is blocking publication, so the UI shows a list
rather than a failed submit. It is readable by anybody who can read the notice,
because the person being blocked is usually the author, not the DPO.

Assembly belongs to the author - the notice, its purposes, its languages, and
any Rule 3 narrowing. Approving a language and publishing stay with the DPO:
those are the review, and an author who could sign off their own text would make
the review a formality.

`/publish` runs in one transaction: validate all Rule 3 elements, generate
`recipients_text` from the project's sites, compute `content_hash` per language,
set published. After this the text is immutable; edits create a new version.
"""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request, status
from pydantic import Field

from cmp.api.dependencies import (
    Paging,
    RequireDPO,
    RequireResource,
    reject_unknown_filters,
)
from cmp.core.enums import NoticeAudience
from cmp.core.errors import Conflict, NotFound, ValidationFailed
from cmp.core.pagination import PageRequest
from cmp.db.pool import connection, transaction
from cmp.db.repositories import notices as repo
from cmp.db.repositories import projects as project_repo
from cmp.domain.audit import service as audit
from cmp.domain.audit.service import Event
from cmp.domain.notices import service as service
from cmp.schemas.common import Acknowledged, CodeText, HttpUrl, LongText, Out, Page, Schema

router = APIRouter(tags=["notices"])

NoticeReader = Annotated[Any, Depends(RequireResource("notice"))]

#: Who may write a notice: the DPO anywhere, the R&D User on their own projects.
#:
#: The R&D User writes it because they are the one who knows what the study
#: collects and why. Asking the DPO to author it meant the DPO transcribing an
#: email and then reviewing their own transcription, which is not a review.
NoticeAuthor = Annotated[Any, Depends(RequireResource("notice", write=True))]


class NoticeOut(Out):
    notice_uuid: UUID
    notice_code: str
    version: int
    withdraw_url: str
    exercise_rights_url: str
    board_complaint_url: str
    dpo_contact: str
    recipients_text: str | None
    status: str
    #: An instruction to whoever collects against this notice. Shown to the DCO
    #: and never served to a data principal - it is a note to the collector, not
    #: part of the notice they are given.
    note: str | None = None
    applicable_to: str | None = None
    change_class: str | None
    published_at: datetime | None
    created_at: datetime
    updated_at: datetime
    purpose_count: int | None = None
    language_count: int | None = None


class NoticeIn(Schema):
    withdraw_url: HttpUrl
    exercise_rights_url: HttpUrl
    board_complaint_url: HttpUrl = Field(
        description="The Data Protection Board portal, NOT the internal grievance form"
    )
    dpo_contact: Annotated[str, Field(min_length=3, max_length=255)]
    #: Who this notice addresses. One value, not a set: a notice written for
    #: employees and for the public at once is two notices with different
    #: obligations wearing one name, and the reader can only be one of them.
    #:
    #: Required before publication, which is checked by the state machine rather
    #: than here - a notice can be started before that is settled.
    applicable_to: NoticeAudience | None = None
    #: A note to whoever collects against this notice. Never served to a data
    #: principal.
    note: Annotated[str | None, Field(default=None, max_length=4000)] = None
    #: Optional. Generated from the project name and the year when omitted - a
    #: DPO cannot see the other projects' codes, so asking them to invent a
    #: unique one is asking them to guess.
    notice_code: CodeText | None = None
    change_class: str | None = None
    #: The text a data subject actually reads. Optional here only so a notice can
    #: be started before the wording exists; publication still refuses without a
    #: rendition, so nothing gets served empty.
    rendered_text: LongText | None = None
    language_code: Annotated[str | None, Field(default=None, max_length=40)] = None


class NoticeCopyIn(Schema):
    """Start this project's notice from one that already exists."""

    source_notice_uuid: UUID


class NoticeUpdate(Schema):
    withdraw_url: HttpUrl | None = None
    exercise_rights_url: HttpUrl | None = None
    board_complaint_url: HttpUrl | None = None
    dpo_contact: Annotated[str | None, Field(default=None, max_length=255)] = None
    applicable_to: NoticeAudience | None = None
    note: Annotated[str | None, Field(default=None, max_length=4000)] = None
    change_class: str | None = None


class AttachPurpose(Schema):
    purpose_uuid: UUID
    display_order: Annotated[int, Field(default=0, ge=0, le=999)] = 0
    is_mandatory: bool = False


class LanguageIn(Schema):
    rendered_text: LongText


class PurposeOnNotice(Out):
    """A purpose as it appears on a notice.

    Declared explicitly so the repository's internal `purpose_id` is filtered out
    rather than serialised. Integer primary keys never appear in a response.
    """

    purpose_uuid: UUID
    purpose_code: str
    name: str
    description: str
    uses: str
    lawful_basis: str
    s7_clause: str | None = None
    data_categories: list[str]
    retention_period: Any
    retention_basis: str
    erasure_trigger: str
    cross_border_permitted: bool
    permitted_for_minors: bool
    status: str
    display_order: int
    is_mandatory: bool

    # Rule 3(b) as *this notice* states it. `data_categories` and `uses` above
    # are already the resolved values - the override where one exists, the
    # purpose's own otherwise - so a reader of this model never has to know
    # which. These four say where the resolved value came from, which is what a
    # DPO editing the notice needs and nobody else does.
    purpose_data_categories: list[str]
    purpose_uses: str
    is_overridden: bool = False
    overridden_at: datetime | None = None
    overridden_by_name: str | None = None


class Checklist(Out):
    publishable: bool
    blocking: list[str]
    purpose_count: int
    language_count: int
    approved_language_count: int
    site_count: int


notice_paging = Paging(repo.LIST_SORTS, "-created_at")


class NoticeListRow(Out):
    notice_uuid: UUID
    notice_code: str
    version: int
    status: str
    published_at: datetime | None
    created_at: datetime
    updated_at: datetime
    project_uuid: UUID
    project_name: str
    purpose_count: int
    language_count: int
    unapproved_languages: int


@router.get("/notices", response_model=Page[NoticeListRow], summary="All notices in scope")
async def list_all_notices(
    request: Request,
    principal: NoticeReader,
    page: Annotated[PageRequest, Depends(notice_paging)],
    notice_status: Annotated[str | None, Query(alias="status")] = None,
    project: Annotated[UUID | None, Query()] = None,
) -> dict[str, Any]:
    """Cross-project notice list.

    The per-project route answers "what does this project have". The console's
    Notices section asks "what is outstanding anywhere", which cannot be
    assembled client-side without one request per project.
    """
    reject_unknown_filters(request, {"status", "project"})
    async with connection() as conn:
        items, cursor, total = await repo.list_all(
            conn,
            page,
            role=principal.role,
            user_id=principal.user_id,
            status=notice_status,
            project_uuid=str(project) if project else None,
        )
    return {"items": items, "next_cursor": cursor, "total": total}


@router.get("/projects/{project_uuid}/notices", response_model=list[NoticeOut])
async def list_notices(project_uuid: UUID, principal: NoticeReader) -> list[dict[str, Any]]:
    async with connection() as conn:
        project = await project_repo.require(
            conn, str(project_uuid), role=principal.role, user_id=principal.user_id
        )
        return await repo.list_for_project(conn, project["project_id"])


@router.post(
    "/projects/{project_uuid}/notices",
    response_model=NoticeOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_notice(
    project_uuid: UUID, body: NoticeIn, principal: NoticeAuthor
) -> dict[str, Any]:
    async with transaction() as conn:
        return await service.create(
            conn,
            project_uuid=str(project_uuid),
            actor_id=principal.user_id,
            role=principal.role,
            notice_code=body.notice_code,
            withdraw_url=body.withdraw_url,
            exercise_rights_url=body.exercise_rights_url,
            board_complaint_url=body.board_complaint_url,
            dpo_contact=body.dpo_contact,
            applicable_to=body.applicable_to or None,
            note=body.note,
            change_class=body.change_class,
            language_code=body.language_code,
            rendered_text=body.rendered_text,
        )


@router.post(
    "/projects/{project_uuid}/notices/copy",
    response_model=NoticeOut,
    status_code=status.HTTP_201_CREATED,
    summary="Copy an existing notice into this project",
)
async def copy_notice(
    project_uuid: UUID, body: NoticeCopyIn, principal: NoticeAuthor
) -> dict[str, Any]:
    """A copy, never a shared row.

    `notice.project_id` is single-valued and every consent artefact records the
    notice it was served from, so two projects sharing one notice row would make
    "which text did she agree to, for which project" unanswerable. The copy
    arrives as a fresh draft with its own code, carrying the purposes and the
    renditions but not the legal approvals.
    """
    async with transaction() as conn:
        return await service.copy_from(
            conn,
            project_uuid=str(project_uuid),
            source_notice_uuid=str(body.source_notice_uuid),
            actor_id=principal.user_id,
            role=principal.role,
        )


async def _require_notice(conn: Any, notice_uuid: str, principal: Any) -> dict[str, Any]:
    notice = await repo.by_uuid(conn, notice_uuid, role=principal.role, user_id=principal.user_id)
    if not notice:
        raise NotFound("Notice")
    return notice


@router.get("/notices/{notice_uuid}", response_model=NoticeOut)
async def get_notice(notice_uuid: UUID, principal: NoticeReader) -> dict[str, Any]:
    async with connection() as conn:
        return await _require_notice(conn, str(notice_uuid), principal)


@router.put("/notices/{notice_uuid}", response_model=NoticeOut, summary="Draft only")
async def update_notice(
    notice_uuid: UUID, body: NoticeUpdate, principal: NoticeAuthor
) -> dict[str, Any]:
    async with transaction() as conn:
        notice = await _require_notice(conn, str(notice_uuid), principal)
        return await service.update(
            conn,
            notice_id=notice["notice_id"],
            withdraw_url=body.withdraw_url,
            exercise_rights_url=body.exercise_rights_url,
            board_complaint_url=body.board_complaint_url,
            dpo_contact=body.dpo_contact,
            applicable_to=body.applicable_to or None,
            note=body.note,
            change_class=body.change_class,
        )


@router.get("/notices/{notice_uuid}/versions", response_model=list[NoticeOut])
async def notice_versions(notice_uuid: UUID, principal: NoticeReader) -> list[dict[str, Any]]:
    async with connection() as conn:
        notice = await _require_notice(conn, str(notice_uuid), principal)
        return await repo.versions(conn, notice["notice_code"])


@router.get("/notices/{notice_uuid}/purposes", response_model=list[PurposeOnNotice])
async def list_notice_purposes(notice_uuid: UUID, principal: NoticeReader) -> list[dict[str, Any]]:
    async with connection() as conn:
        notice = await _require_notice(conn, str(notice_uuid), principal)
        return await repo.purposes_of(conn, notice["notice_id"])


@router.post("/notices/{notice_uuid}/purposes", status_code=status.HTTP_201_CREATED)
async def attach_purpose(
    notice_uuid: UUID, body: AttachPurpose, principal: NoticeAuthor
) -> dict[str, Any]:
    """`is_mandatory = true` should be rare and should make you uncomfortable.

    If a purpose cannot be refused, ask whether it belongs in this notice at all.
    """
    async with transaction() as conn:
        notice = await _require_notice(conn, str(notice_uuid), principal)
        row = await service.attach_purpose(
            conn,
            notice_id=notice["notice_id"],
            purpose_uuid=str(body.purpose_uuid),
            display_order=body.display_order,
            is_mandatory=body.is_mandatory,
        )
    return {
        **row,
        "warning": (
            "A mandatory purpose cannot be refused. Consider whether it belongs in this notice."
            if body.is_mandatory
            else None
        ),
    }


class PurposeOverride(Schema):
    """Rule 3(b), for this notice only.

    Both fields null clears the override and the notice reverts to the purpose's
    own wording. That is the same operation as "reset", so there is no separate
    endpoint for it.
    """

    #: Rule 3(b)(i): the personal data to be collected, itemised. Must be a
    #: subset of the purpose's own list - a notice narrows, never widens.
    data_categories: list[str] | None = None
    #: Rule 3(b)(ii): the specific uses this notice enables.
    uses: Annotated[str | None, Field(default=None, max_length=20_000)] = None


@router.put(
    "/notices/{notice_uuid}/purposes/{purpose_uuid}",
    summary="Narrow Rule 3(b) for this notice",
)
async def override_purpose(
    notice_uuid: UUID,
    purpose_uuid: UUID,
    body: PurposeOverride,
    principal: NoticeAuthor,
) -> dict[str, Any]:
    """State Rule 3(b) more narrowly on this notice than the purpose does.

    A purpose is shared reference data: the same "Loyalty enrolment" is attached
    to every notice that needs it, and its `data_categories` list covers every
    collection it might serve. A specific project usually takes less than that,
    and until now the only way to say so was to edit the shared purpose - which
    changed every other notice using it.

    **The override may only narrow.** `data_categories` must be a subset of the
    purpose's, and the check is here rather than in a constraint because "is
    this list contained in that one" is not a CHECK worth writing in SQL. The
    rule matters: a notice that promised *more* than its purpose permits would
    be collecting outside the basis it cites, which is the failure this whole
    system exists to prevent.

    `uses` is free text and cannot be checked mechanically, so it is attributed
    instead - `overridden_by` and `overridden_at` are recorded, and the audit
    event carries both texts. A human reviews it; the record says who.

    Draft notices only. A published notice is frozen and hashed; changing what
    it says is a new version, not an edit.
    """
    async with transaction() as conn:
        notice = await _require_notice(conn, str(notice_uuid), principal)
        if notice["status"] != "draft":
            raise Conflict(
                f"This notice is {notice['status']}. A published notice is frozen - "
                "changing what it says is a new version.",
                code="notice_not_draft",
            )

        attached = await repo.purposes_of(conn, notice["notice_id"])
        purpose = next((p for p in attached if str(p["purpose_uuid"]) == str(purpose_uuid)), None)
        if purpose is None:
            raise NotFound("Purpose on this notice")

        if body.data_categories is not None:
            if not body.data_categories:
                raise ValidationFailed(
                    "Rule 3(b)(i) requires the data itemised. An empty list is not a "
                    "narrowing, it is a notice that itemises nothing.",
                    field="data_categories",
                )
            widened = sorted(set(body.data_categories) - set(purpose["purpose_data_categories"]))
            if widened:
                raise ValidationFailed(
                    "A notice can narrow what its purpose covers, never widen it. "
                    f"Not covered by '{purpose['purpose_code']}': {', '.join(widened)}.",
                    field="data_categories",
                )

        await repo.set_purpose_override(
            conn,
            notice_id=notice["notice_id"],
            purpose_id=purpose["purpose_id"],
            data_categories=body.data_categories,
            uses=body.uses,
            actor_id=principal.user_id,
        )

        await audit.record(
            conn,
            event=Event.NOTICE_PURPOSE_OVERRIDDEN,
            entity_type="notice",
            entity_id=notice["notice_id"],
            detail={
                "purpose": str(purpose_uuid),
                "purpose_code": purpose["purpose_code"],
                "cleared": body.data_categories is None and body.uses is None,
                "data_categories": body.data_categories,
                "uses": body.uses,
                "purpose_data_categories": purpose["purpose_data_categories"],
            },
        )

        return {
            "ok": True,
            "message": (
                "Reverted to the purpose's own wording."
                if body.data_categories is None and body.uses is None
                else "This notice now states Rule 3(b) more narrowly than its purpose."
            ),
        }


@router.delete(
    "/notices/{notice_uuid}/purposes/{purpose_uuid}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Draft only",
)
async def detach_purpose(notice_uuid: UUID, purpose_uuid: UUID, principal: NoticeAuthor) -> None:
    async with transaction() as conn:
        notice = await _require_notice(conn, str(notice_uuid), principal)
        await service.detach_purpose(
            conn, notice_id=notice["notice_id"], purpose_uuid=str(purpose_uuid)
        )


@router.get("/notices/{notice_uuid}/languages")
async def list_languages(notice_uuid: UUID, principal: NoticeReader) -> list[dict[str, Any]]:
    """Every rendition of this notice, with its text.

    The text is included, and its absence was a real gap rather than a saving:
    without it there was nowhere in the console to *read* a notice, and the
    editor opened blank because the form had nothing to prefill from. Both
    symptoms, one missing column.

    It is not sensitive - this is the text a data principal is shown, and anyone
    reaching this endpoint can already read the notice. Volume is not a concern
    either: a notice has at most a handful of renditions, and they are the
    content of the page asking for them.
    """
    async with connection() as conn:
        notice = await _require_notice(conn, str(notice_uuid), principal)
        return await repo.languages_of(conn, notice["notice_id"], with_text=True)


@router.post("/notices/{notice_uuid}/languages", status_code=status.HTTP_201_CREATED)
async def add_language(
    notice_uuid: UUID,
    body: LanguageIn,
    principal: NoticeAuthor,
    language_code: Annotated[str, Query()],
) -> dict[str, Any]:
    async with transaction() as conn:
        notice = await _require_notice(conn, str(notice_uuid), principal)
        return await service.set_language(
            conn,
            notice_id=notice["notice_id"],
            language_code=language_code,
            rendered_text=body.rendered_text,
            actor_id=principal.user_id,
        )


@router.put("/notices/{notice_uuid}/languages/{code}", summary="Draft only")
async def update_language(
    notice_uuid: UUID, code: str, body: LanguageIn, principal: NoticeAuthor
) -> dict[str, Any]:
    """Replacing the text clears the approval.

    Text that changed after a lawyer signed it off has not been signed off.
    """
    async with transaction() as conn:
        notice = await _require_notice(conn, str(notice_uuid), principal)
        return await service.set_language(
            conn,
            notice_id=notice["notice_id"],
            language_code=code,
            rendered_text=body.rendered_text,
            actor_id=principal.user_id,
        )


@router.post("/notices/{notice_uuid}/languages/{code}/approve", response_model=Acknowledged)
async def approve_language(notice_uuid: UUID, code: str, principal: RequireDPO) -> dict[str, Any]:
    """Approval is per language, not once per notice."""
    async with transaction() as conn:
        notice = await _require_notice(conn, str(notice_uuid), principal)
        row = await service.approve_language(
            conn,
            notice_id=notice["notice_id"],
            language_code=code,
            actor_id=principal.user_id,
        )
    return {"ok": True, "message": f"'{code}' approved (sha256 {row['content_hash'][:12]}…)."}


@router.get("/notices/{notice_uuid}/checklist", response_model=Checklist)
async def checklist(notice_uuid: UUID, principal: NoticeReader) -> dict[str, Any]:
    async with connection() as conn:
        notice = await _require_notice(conn, str(notice_uuid), principal)
        return await service.checklist(conn, notice["notice_id"])


@router.get("/notices/{notice_uuid}/preview")
async def preview(
    notice_uuid: UUID,
    principal: NoticeReader,
    language_code: Annotated[str | None, Query()] = None,
) -> dict[str, Any]:
    async with connection() as conn:
        notice = await _require_notice(conn, str(notice_uuid), principal)
        return await service.preview(conn, notice["notice_id"], language_code)


@router.post("/notices/{notice_uuid}/publish", response_model=NoticeOut)
async def publish(notice_uuid: UUID, principal: RequireDPO) -> dict[str, Any]:
    async with transaction() as conn:
        notice = await _require_notice(conn, str(notice_uuid), principal)
        await service.publish(conn, notice_id=notice["notice_id"], actor_id=principal.user_id)
        return await _require_notice(conn, str(notice_uuid), principal)
