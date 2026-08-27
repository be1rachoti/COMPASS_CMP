"""Projects (10), approvals (4), sites (6).

`GET /projects/{uuid}/transitions` is the endpoint that stops the frontend from
holding a second copy of the state machine. Without it the SPA either hardcodes
the transitions - which will drift from the backend - or shows buttons that fail
on click.
"""

from __future__ import annotations

import re
from datetime import date, datetime
from pathlib import Path
from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, Query, Request, Response, UploadFile, status
from pydantic import Field

from cmp.api.dependencies import (
    CurrentUser,
    Paging,
    RequireDPO,
    RequireResource,
    reject_unknown_filters,
)
from cmp.core.config import settings
from cmp.core.errors import BadRequest, Forbidden, NotFound, ValidationFailed
from cmp.core.pagination import PageRequest
from cmp.core.permissions import Role
from cmp.core.security import file_hash
from cmp.db.pool import connection, transaction
from cmp.db.repositories import consent as consent_repo
from cmp.db.repositories import projects as repo
from cmp.domain.audit import service as audit
from cmp.domain.audit.service import Event
from cmp.domain.consent import service as consent_service
from cmp.domain.projects import service as service
from cmp.domain.projects.state_machine import COLLECTION_OWNERS
from cmp.infrastructure.storage import read_upload, save_approval_proof
from cmp.schemas.common import Acknowledged, LongText, Out, Page, Schema, ShortText

router = APIRouter(tags=["projects"])

project_paging = Paging(repo.LIST_SORTS, "-created_at")


class ProjectOut(Out):
    project_uuid: UUID
    project_name: str
    internal_project_name: str | None
    description: str | None
    requesting_team: str | None
    project_status: str
    dco_uuid: UUID | None = None
    dco_name: str | None = None
    created_by_name: str | None = None
    current_notice_uuid: UUID | None = None
    created_at: datetime
    updated_at: datetime


class ProjectIn(Schema):
    project_name: ShortText
    description: LongText
    #: Who will collect. At least one, and several is ordinary - a study running
    #: at a partner campus and in-house at the same time names both.
    #:
    #: This replaced a nominated DCO. Which *person* is accountable follows from
    #: the data sources chosen under these processors, and those are not chosen
    #: yet; naming a DCO here was answering for a decision nobody had taken.
    processor_uuids: Annotated[list[UUID], Field(min_length=1, max_length=20)]
    internal_project_name: ShortText | None = None
    requesting_team: Annotated[str | None, Field(default=None, max_length=120)] = None


class ProjectUpdate(Schema):
    project_name: ShortText | None = None
    description: LongText | None = None
    internal_project_name: ShortText | None = None
    requesting_team: Annotated[str | None, Field(default=None, max_length=120)] = None


class TransitionRequest(Schema):
    to: str
    reason: Annotated[str | None, Field(default=None, max_length=1000)] = None


class ProcessorsIn(Schema):
    processor_uuids: Annotated[list[UUID], Field(min_length=1, max_length=20)]


class ProcessorRequestIn(Schema):
    processor_uuid: UUID


class ProcessorDecisionIn(Schema):
    approved: bool
    #: Required on a refusal, and the database enforces it too. "No" with
    #: nothing after it is a decision the R&D User cannot act on, so they ask
    #: again and get it again.
    reason: Annotated[str | None, Field(default=None, max_length=1000)] = None


class SiteIn(Schema):
    """A collection site is the deployment of one data source on one project.

    That is why the data source is the only required field. It decides the
    processor (a source belongs to one), the label (a site has no name of its
    own - it *is* that source, standing somewhere), and who is accountable (the
    source carries its owner). Asking for those separately invited them to
    disagree with each other, and a site whose label said one thing while its
    source said another had two answers to one question.

    The source has to be one of the project's own processors'. Anything else
    would mean collecting through an organisation the DPO did not review.
    """

    source_uuid: UUID
    #: Where it physically stands. Optional, and free text, because it is the
    #: line a data principal reads in the notice's recipient list - "Pune,
    #: Maharashtra" - rather than anything the system reasons about.
    location: Annotated[str | None, Field(default=None, max_length=200)] = None


class SiteOwnerAssign(Schema):
    """Who runs this site on this project, when it is not the source's owner.

    `null` clears the exception and the site goes back to whoever owns its data
    source — the usual way an override ends, because it was cover and the cover
    finished.
    """

    owner_user_uuid: UUID | None = None


class SiteSourceAssign(Schema):
    """Which data source stands at this site.

    `null` detaches, which is a real operation: a site between sources is
    honestly unassigned, and leaving the previous one attached would say
    collection is happening somewhere it is not.
    """

    source_uuid: UUID | None = None


class SiteUpdate(Schema):
    site_label: Annotated[str | None, Field(default=None, max_length=160)] = None
    location: Annotated[str | None, Field(default=None, max_length=200)] = None


class AgentAssign(Schema):
    expires_at: datetime
    max_uses: Annotated[int | None, Field(default=None, ge=1, le=100_000)] = None
    agent_ref: Annotated[str | None, Field(default=None, max_length=120)] = None


ProjectReader = Annotated[Any, Depends(RequireResource("project"))]

#: Extension to media type for approval proofs. Kept narrow on purpose - this
#: mapping decides what a browser will render inline, and an open-ended one turns
#: an upload slot into a way to serve arbitrary content from our origin.
_PROOF_MEDIA_TYPES: dict[str, str] = {
    ".pdf": "application/pdf",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
}


site_paging = Paging(repo.SITE_SORTS, "-created_at")
approval_paging = Paging(repo.APPROVAL_SORTS, "-uploaded_at")


class SiteListRow(Out):
    site_uuid: UUID
    site_label: str
    location: str | None = None
    status: str
    created_at: datetime
    project_uuid: UUID
    project_name: str
    project_status: str
    processor_uuid: UUID | None = None
    processor_name: str | None = None
    active_links: int


class ApprovalListRow(Out):
    approval_uuid: UUID
    approval_type: str
    reference_no: str
    approved_on: date
    proof_file_hash: str
    uploaded_at: datetime
    project_uuid: UUID
    project_name: str
    project_status: str
    uploaded_by_uuid: UUID
    uploaded_by_name: str


# ===================================================== cross-project listings
@router.get("/sites", response_model=Page[SiteListRow], summary="All sites in scope")
async def list_all_sites(
    request: Request,
    principal: ProjectReader,
    page: Annotated[PageRequest, Depends(site_paging)],
    site_status: Annotated[str | None, Query(alias="status")] = None,
) -> dict[str, Any]:
    """Every collection site in scope.

    A site is a recipient named in a published notice, so this doubles as the
    answer to "where does our data actually go".
    """
    reject_unknown_filters(request, {"status"})
    async with connection() as conn:
        items, cursor, total = await repo.list_all_sites(
            conn, page, role=principal.role, user_id=principal.user_id, status=site_status
        )
    return {"items": items, "next_cursor": cursor, "total": total}


@router.get("/approvals", response_model=Page[ApprovalListRow], summary="All approvals in scope")
async def list_all_approvals(
    principal: ProjectReader,
    page: Annotated[PageRequest, Depends(approval_paging)],
) -> dict[str, Any]:
    """Every approval in scope, with the hash of its proof file (INV-8)."""
    async with connection() as conn:
        items, cursor, total = await repo.list_all_approvals(
            conn, page, role=principal.role, user_id=principal.user_id
        )
    return {"items": items, "next_cursor": cursor, "total": total}


# ================================================================= projects
@router.get("/projects", response_model=Page[ProjectOut])
async def list_projects(
    request: Request,
    principal: ProjectReader,
    page: Annotated[PageRequest, Depends(project_paging)],
    project_status: Annotated[str | None, Query(alias="status")] = None,
    q: Annotated[str | None, Query(max_length=100)] = None,
) -> dict[str, Any]:
    reject_unknown_filters(request, {"status", "q"})
    async with connection() as conn:
        items, cursor, total = await repo.list_projects(
            conn,
            page,
            role=principal.role,
            user_id=principal.user_id,
            project_status=project_status,
            q=q,
        )
    return {"items": items, "next_cursor": cursor, "total": total}


@router.post("/projects", response_model=ProjectOut, status_code=status.HTTP_201_CREATED)
async def create_project(body: ProjectIn, principal: CurrentUser) -> dict[str, Any]:
    if principal.role is not Role.RND_USER:
        raise Forbidden("Only an R&D User may register a project")
    async with transaction() as conn:
        return await service.create(
            conn,
            actor_id=principal.user_id,
            project_name=body.project_name,
            description=body.description,
            processor_uuids=[str(u) for u in body.processor_uuids],
            internal_project_name=body.internal_project_name,
            requesting_team=body.requesting_team,
        )


@router.get("/projects/{project_uuid}", response_model=ProjectOut)
async def get_project(project_uuid: UUID, principal: ProjectReader) -> dict[str, Any]:
    async with connection() as conn:
        return await repo.require(
            conn, str(project_uuid), role=principal.role, user_id=principal.user_id
        )


@router.put("/projects/{project_uuid}", response_model=ProjectOut, summary="Draft only")
async def update_project(
    project_uuid: UUID, body: ProjectUpdate, principal: CurrentUser
) -> dict[str, Any]:
    if principal.role is not Role.RND_USER:
        raise Forbidden("Only the R&D User who created a project may edit it")
    async with transaction() as conn:
        return await service.update_draft(
            conn,
            project_uuid=str(project_uuid),
            actor_id=principal.user_id,
            role=principal.role,
            project_name=body.project_name,
            description=body.description,
            internal_project_name=body.internal_project_name,
            requesting_team=body.requesting_team,
        )


@router.get("/projects/{project_uuid}/transitions", summary="What may happen next, and why not")
async def transitions(project_uuid: UUID, principal: ProjectReader) -> dict[str, Any]:
    async with connection() as conn:
        return await service.transitions_for(
            conn,
            project_uuid=str(project_uuid),
            role=principal.role,
            user_id=principal.user_id,
        )


@router.post("/projects/{project_uuid}/transition")
async def transition(
    project_uuid: UUID, body: TransitionRequest, principal: ProjectReader
) -> dict[str, Any]:
    async with transaction() as conn:
        return await service.transition(
            conn,
            project_uuid=str(project_uuid),
            target=body.to,
            role=principal.role,
            actor_id=principal.user_id,
            reason=body.reason,
        )


@router.get("/projects/{project_uuid}/history")
async def project_history(project_uuid: UUID, principal: ProjectReader) -> list[dict[str, Any]]:
    async with connection() as conn:
        project = await repo.require(
            conn, str(project_uuid), role=principal.role, user_id=principal.user_id
        )
        return await repo.history(conn, project["project_id"])


@router.get("/projects/{project_uuid}/summary", summary="Everything a dashboard needs, in one call")
async def project_summary(project_uuid: UUID, principal: ProjectReader) -> dict[str, Any]:
    async with connection() as conn:
        project = await repo.require(
            conn, str(project_uuid), role=principal.role, user_id=principal.user_id
        )
        counts = await repo.summary(conn, project["project_id"])
        consents = await repo.consent_counts(conn, project["project_id"])
        facts = await repo.facts(conn, project["project_id"])
    return {
        "project_uuid": str(project_uuid),
        "project_name": project["project_name"],
        "project_status": project["project_status"],
        "counts": counts,
        "consents": consents,
        "readiness": {
            "notice_published": bool(facts.get("notice_published")),
            "rule3_complete": bool(facts.get("notice_rule3_complete")),
            "approvals_with_proof": int(facts.get("approval_with_proof_count") or 0),
        },
    }


@router.get("/projects/{project_uuid}/processors")
async def list_project_processors(
    project_uuid: UUID, principal: ProjectReader
) -> list[dict[str, Any]]:
    async with connection() as conn:
        project = await repo.require(
            conn, str(project_uuid), role=principal.role, user_id=principal.user_id
        )
        return await repo.processors_for(conn, project["project_id"])


@router.put("/projects/{project_uuid}/processors", summary="Draft only — replaces the set")
async def set_project_processors(
    project_uuid: UUID, body: ProcessorsIn, principal: ProjectReader
) -> list[dict[str, Any]]:
    """Change who will collect, while the project is still in draft.

    The R&D User alone, and their own projects alone - row scope sees to the
    second half. Naming the collectors is the initiator's decision because it is
    the one they are answerable for: the study is theirs, and the partners are
    the ones they arranged. A DPO who disagreed with the choice returns the
    project to draft and says so, which leaves a record; editing it silently
    would not.

    Nobody may after approval: the processors are what the DPO reviewed and what
    the routing was decided from, so changing them would re-point an approved
    project at a collector nobody approved.
    """
    if principal.role is not Role.RND_USER:
        raise Forbidden("Only the R&D User who owns this project may change its processors")
    async with transaction() as conn:
        return await service.set_processors(
            conn,
            project_uuid=str(project_uuid),
            processor_uuids=[str(u) for u in body.processor_uuids],
            actor_id=principal.user_id,
            role=principal.role,
        )


@router.post("/projects/{project_uuid}/processors", status_code=status.HTTP_201_CREATED)
async def request_project_processor(
    project_uuid: UUID, body: ProcessorRequestIn, principal: ProjectReader
) -> dict[str, Any]:
    """Add a collector, or ask the DPO to let you.

    Which of the two depends on where the project is, and the caller does not
    choose. In draft it is added outright - the DPO reviews the whole project at
    approval, so asking separately would be the same question twice. Once the
    project is approved, or while it is being reviewed, it is a request: the
    processor goes on the list marked pending and nothing may collect under it
    until the DPO answers.

    The R&D User alone, because naming the collectors is the initiator's
    decision - the study is theirs and the partners are the ones they arranged.
    """
    if principal.role is not Role.RND_USER:
        raise Forbidden("Only the R&D User who owns this project may add a processor")
    async with transaction() as conn:
        return await service.request_processor(
            conn,
            project_uuid=str(project_uuid),
            processor_uuid=str(body.processor_uuid),
            actor_id=principal.user_id,
            role=principal.role,
        )


@router.post("/projects/{project_uuid}/processors/{processor_uuid}/decision")
async def decide_project_processor(
    project_uuid: UUID,
    processor_uuid: UUID,
    body: ProcessorDecisionIn,
    principal: RequireDPO,
) -> dict[str, Any]:
    """Approve or refuse a collector proposed for an approved project.

    One endpoint with a decision rather than two verbs, because a refusal
    carries a reason and an approval does not - and a pair of routes where only
    one takes a body invites the reason being posted to the wrong one.

    Approving does not move the project. It makes the processor real, and the
    work then appears where it belongs: a third party's on the DCO Admin's
    queue, an in-house one back with the R&D owner. Nothing about the project
    changed - something was added to it.
    """
    async with transaction() as conn:
        return await service.decide_processor(
            conn,
            project_uuid=str(project_uuid),
            processor_uuid=str(processor_uuid),
            approved=body.approved,
            reason=body.reason,
            actor_id=principal.user_id,
            role=principal.role,
        )


@router.post("/projects/{project_uuid}/close")
async def close_project(
    project_uuid: UUID, body: TransitionRequest, principal: ProjectReader
) -> dict[str, Any]:
    # The same set the state machine names for this transition. It listed only
    # the DPO and the DCO, written before the other two collection owners
    # existed - so an RCO could not close a project the state machine said they
    # could, and the two disagreed with nothing to reconcile them.
    if principal.role is not Role.DPO and principal.role not in COLLECTION_OWNERS:
        raise Forbidden("Only a DPO or a collection owner may close a project")
    async with transaction() as conn:
        return await service.close(
            conn,
            project_uuid=str(project_uuid),
            actor_id=principal.user_id,
            role=principal.role,
            reason=body.reason,
        )


# ================================================================ approvals
@router.get("/projects/{project_uuid}/approvals")
async def list_approvals(project_uuid: UUID, principal: ProjectReader) -> list[dict[str, Any]]:
    async with connection() as conn:
        project = await repo.require(
            conn, str(project_uuid), role=principal.role, user_id=principal.user_id
        )
        return await repo.list_approvals(conn, project["project_id"])


@router.post(
    "/projects/{project_uuid}/approvals",
    status_code=status.HTTP_201_CREATED,
    summary="Upload an approval - proof is mandatory (INV-8)",
)
async def add_approval(
    project_uuid: UUID,
    principal: CurrentUser,
    approval_type: Annotated[str, Form()],
    reference_no: Annotated[str, Form(max_length=120)],
    approved_on: Annotated[date, Form()],
    proof: Annotated[UploadFile, File(description="PDF or image, max 25 MB")],
) -> dict[str, Any]:
    if principal.role is not Role.RND_USER:
        raise Forbidden("Only the R&D User may upload an approval")

    payload = await proof.read()
    if not payload:
        raise ValidationFailed("The proof file is empty", field="proof")
    if len(payload) > settings.max_upload_bytes:
        raise BadRequest(
            f"Proof exceeds {settings.max_upload_bytes // (1024 * 1024)} MB",
            code="payload_too_large",
            field="proof",
        )
    if proof.content_type not in settings.allowed_proof_mime:
        raise ValidationFailed(
            f"Proof must be one of: {', '.join(settings.allowed_proof_mime)}", field="proof"
        )

    digest = file_hash(payload)
    stored = save_approval_proof(payload, proof.filename)

    async with transaction() as conn:
        return await service.add_approval(
            conn,
            project_uuid=str(project_uuid),
            actor_id=principal.user_id,
            role=principal.role,
            approval_type=approval_type,
            reference_no=reference_no,
            approved_on=approved_on,
            proof_file_ref=stored,
            proof_file_hash=digest,
        )


@router.get("/approvals/{approval_uuid}")
async def get_approval(approval_uuid: UUID, principal: ProjectReader) -> dict[str, Any]:
    async with connection() as conn:
        approval = await repo.approval_by_uuid(
            conn, str(approval_uuid), role=principal.role, user_id=principal.user_id
        )
        if not approval:
            raise NotFound("Approval")
        approval.pop("proof_file_ref", None)  # the storage path is not a client concern
        return approval


@router.get("/approvals/{approval_uuid}/proof", summary="Download the proof file")
async def download_proof(approval_uuid: UUID, principal: ProjectReader) -> Response:
    if principal.role not in (Role.DPO, Role.RND_USER):
        raise Forbidden("Your role may not download approval proof")

    async with transaction() as conn:
        approval = await repo.approval_by_uuid(
            conn, str(approval_uuid), role=principal.role, user_id=principal.user_id
        )
        if not approval:
            raise NotFound("Approval")
        await audit.record(
            conn,
            event=Event.APPROVAL_PROOF_DOWNLOADED,
            entity_type="project_approval",
            entity_id=approval["approval_id"],
        )

    payload = read_upload(approval["proof_file_ref"])
    served = file_hash(payload)

    # The extension is not decoration. Without it the browser saves a file the
    # operating system cannot open, and the person who downloaded a security
    # approval to read it is left renaming it by guesswork. It comes from the
    # stored reference rather than the client's original name, which was
    # normalised to a safe suffix on the way in.
    suffix = Path(str(approval["proof_file_ref"])).suffix.lower() or ".bin"
    safe_reference = re.sub(r"[^A-Za-z0-9._-]+", "-", str(approval["reference_no"])).strip("-")
    filename = f"approval-{safe_reference or 'proof'}{suffix}"

    return Response(
        content=payload,
        # The real type, so a PDF opens as a PDF. octet-stream forced a download
        # even where the viewer only wanted to look at it.
        media_type=_PROOF_MEDIA_TYPES.get(suffix, "application/octet-stream"),
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            # The stored hash travels with the file so a recipient can check that
            # what they received is what was uploaded.
            "X-Content-SHA256": served,
            "X-Recorded-SHA256": approval["proof_file_hash"],
            # Without this the browser hides both hash headers from the page, and
            # the integrity check the caller is meant to run cannot run.
            "Access-Control-Expose-Headers": (
                "Content-Disposition, X-Content-SHA256, X-Recorded-SHA256"
            ),
        },
    )


# ==================================================================== sites
@router.get("/projects/{project_uuid}/sites")
async def list_sites(project_uuid: UUID, principal: ProjectReader) -> list[dict[str, Any]]:
    async with connection() as conn:
        project = await repo.require(
            conn, str(project_uuid), role=principal.role, user_id=principal.user_id
        )
        return await repo.list_sites(
            conn, project["project_id"], role=principal.role, user_id=principal.user_id
        )


@router.post("/projects/{project_uuid}/sites", status_code=status.HTTP_201_CREATED)
async def add_site(project_uuid: UUID, body: SiteIn, principal: ProjectReader) -> dict[str, Any]:
    """Register where collection will physically happen.

    The R&D User is included because they are the one who knows: they designed
    the study, they know which lab or clinic is running it, and which processor
    operates it. Leaving this to the DPO meant the DPO inventing a site to get
    past their own publication screen.

    The DCO Admin and the RCO are included because registering the site is the
    first half of the job they exist to do. Routing an approved project means
    saying where collection happens and what stands there, and a role that could
    attach a source but not create the site it attaches to would be able to
    finish the work only if somebody else had started it.

    What it takes is a data source, chosen from those registered under the
    project's processors - not a name typed by hand. A site is where one of
    those sources stands.
    """
    if principal.role not in (Role.DPO, Role.DCO, Role.DCO_ADMIN, Role.RCO, Role.RND_USER):
        raise Forbidden("Only a DPO, a collection owner or an R&D User may add a site")
    async with transaction() as conn:
        return await service.add_site(
            conn,
            project_uuid=str(project_uuid),
            actor_id=principal.user_id,
            role=principal.role,
            source_uuid=str(body.source_uuid),
            location=body.location,
        )


@router.get("/sites/{site_uuid}")
async def get_site(site_uuid: UUID, principal: ProjectReader) -> dict[str, Any]:
    async with connection() as conn:
        site = await repo.site_by_uuid(
            conn, str(site_uuid), role=principal.role, user_id=principal.user_id
        )
        if not site:
            raise NotFound("Site")
        return site


@router.put("/sites/{site_uuid}")
async def update_site(
    site_uuid: UUID, body: SiteUpdate, principal: ProjectReader
) -> dict[str, Any]:
    async with transaction() as conn:
        site = await repo.site_by_uuid(
            conn, str(site_uuid), role=principal.role, user_id=principal.user_id
        )
        if not site:
            raise NotFound("Site")
        updated = await repo.update_site(
            conn, site["site_id"], site_label=body.site_label, location=body.location
        )
        await audit.record(
            conn,
            event=Event.SITE_UPDATED,
            entity_type="project_site",
            entity_id=site["site_id"],
        )
    return updated


@router.put("/sites/{site_uuid}/source", summary="Attach the data source that stands here")
async def assign_site_source(
    site_uuid: UUID, body: SiteSourceAssign, principal: CurrentUser
) -> dict[str, Any]:
    """Attach a data source to a site. The project follows.

    This is the routing step, and it is deliberately not a way to name a person.
    A source carries its own owner, so choosing CIT for a site is choosing
    whoever runs CIT - the two cannot disagree, because there is only one of
    them. `trg_site_owner` re-derives `project.dco_user_id` from the primary
    site on commit, and the project appears in that owner's list.

    Who may call it follows the same split as the routing itself:

    * a **DCO Admin** on a project collected by a third party - that queue is
      their job;
    * the **R&D owner** on one collected in-house, which is where an approved
      project goes back to them to name the sources and an RCO;
    * a **DPO** or **administrator** anywhere, for correction.

    A DCO is not on that list. Reassigning their own sites would let them hand
    themselves somebody else's project, or drop one they no longer want.

    The response reports the routing consequence rather than leaving the caller
    to infer it: `project_moved` is true when this changed who owns the project,
    which is the fact somebody needs to see before they close the dialog.
    """
    if principal.role not in (Role.DPO, Role.ADMIN, Role.DCO_ADMIN, Role.RND_USER):
        raise Forbidden("Only a DPO, administrator, DCO Admin or the R&D owner may do this")

    async with transaction() as conn:
        site = await repo.site_by_uuid(
            conn, str(site_uuid), role=principal.role, user_id=principal.user_id
        )
        if not site:
            raise NotFound("Site")

        result = await service.assign_source(
            conn,
            project_uuid=str(site["project_uuid"]),
            site_uuid=str(site_uuid),
            source_uuid=str(body.source_uuid) if body.source_uuid else None,
            actor_id=principal.user_id,
            role=principal.role,
        )

    return {
        "ok": True,
        "project_moved": result["owner_changed"],
        "message": (
            "Source attached. This project has moved to its owner."
            if result["owner_changed"]
            else "Source attached. The project's owner is unchanged."
        ),
    }


@router.put("/sites/{site_uuid}/owner", summary="Name who runs this site, overriding its source")
async def assign_site_owner(
    site_uuid: UUID, body: SiteOwnerAssign, principal: CurrentUser
) -> dict[str, Any]:
    """Override the owner a site inherits from its data source.

    Attaching a source picks the owner automatically and that is right almost
    every time. This is the exception: cover, a handover, a partner who insists
    on a named contact. Several sites on one project can each name a different
    person.

    **It does not move the source.** The rig keeps its owner and every other
    project collecting from it is untouched — which is the whole reason this is
    a separate operation rather than a shortcut into `PUT /sources/{uuid}/owner`.
    That endpoint moves everybody; this one moves one site.

    Who may call it follows the routing: a **DCO Admin** on third-party
    collection, the **R&D owner** on in-house, and a **DPO** or **administrator**
    anywhere. A DCO is absent for the same reason as everywhere else — naming
    themselves on somebody else's site is exactly what this must not enable.
    """
    if principal.role not in (Role.DPO, Role.ADMIN, Role.DCO_ADMIN, Role.RND_USER):
        raise Forbidden("Only a DPO, administrator, DCO Admin or the R&D owner may do this")

    async with transaction() as conn:
        site = await repo.site_by_uuid(
            conn, str(site_uuid), role=principal.role, user_id=principal.user_id
        )
        if not site:
            raise NotFound("Site")

        result = await service.assign_site_owner(
            conn,
            project_uuid=str(site["project_uuid"]),
            site_uuid=str(site_uuid),
            owner_user_uuid=str(body.owner_user_uuid) if body.owner_user_uuid else None,
            actor_id=principal.user_id,
            role=principal.role,
        )

    return {
        "ok": True,
        "project_moved": result["project_moved"],
        "message": (
            "This site now has its own owner. The data source is unchanged, so no other "
            "project has moved."
            if body.owner_user_uuid
            else "Cleared. This site goes back to whoever owns its data source."
        ),
    }


@router.post("/sites/{site_uuid}/deactivate", response_model=Acknowledged)
async def deactivate_site(site_uuid: UUID, principal: RequireDPO) -> dict[str, Any]:
    async with transaction() as conn:
        site = await repo.site_by_uuid(
            conn, str(site_uuid), role=principal.role, user_id=principal.user_id
        )
        if not site:
            raise NotFound("Site")
        await repo.deactivate_site(conn, site["site_id"])
        revoked = await consent_repo.revoke_links_for_project(
            conn, project_uuid=str(site["project_uuid"]), actor_id=principal.user_id
        )
        await audit.record(
            conn,
            event=Event.SITE_DEACTIVATED,
            entity_type="project_site",
            entity_id=site["site_id"],
            detail={"links_revoked": revoked},
        )
    return {"ok": True, "message": f"Site deactivated. {revoked} link(s) revoked."}


@router.post("/sites/{site_uuid}/agent", summary="Assign the Field Agent and mint the link")
async def assign_agent(
    site_uuid: UUID, body: AgentAssign, principal: ProjectReader
) -> dict[str, Any]:
    """`expires_at` is required - no default and no maximum.

    The absence of a pre-fill is the control. Somebody has to decide how long
    this link should live; a default would be chosen once and never revisited.

    The token is returned exactly once. What the database holds is its keyed
    digest, so this response is the only opportunity to capture it.
    """
    # Whoever is accountable for collection at the site, which is now three
    # roles rather than one. Minting is still confined to sites they actually
    # run: `site_by_uuid` applies the site scope, so widening the role here
    # widens nobody's reach - it only stops an RCO being refused their own.
    if principal.role is not Role.DPO and principal.role not in COLLECTION_OWNERS:
        raise Forbidden("Only a DPO or a collection owner may assign a Field Agent")

    async with transaction() as conn:
        link = await consent_service.create_link(
            conn,
            site_uuid=str(site_uuid),
            expires_at=body.expires_at,
            max_uses=body.max_uses,
            actor_id=principal.user_id,
            role=principal.role,
        )
        await audit.record(
            conn,
            event=Event.SITE_AGENT_ASSIGNED,
            entity_type="consent_link",
            entity_id=link["link_id"],
            detail={"site": str(site_uuid), "agent_ref": body.agent_ref},
        )
    return {
        "link_uuid": link["link_uuid"],
        "token": link["token"],
        "url_path": f"/c/{link['token']}",
        "expires_at": link["expires_at"],
        "max_uses": link["max_uses"],
        "warning": "This token is shown once and cannot be retrieved again.",
    }
