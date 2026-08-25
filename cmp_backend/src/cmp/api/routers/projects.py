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

from cmp.api.deps import CurrentUser, Paging, RequireDPO, RequireResource, reject_unknown_filters
from cmp.core.config import settings
from cmp.core.errors import BadRequest, Forbidden, NotFound, ValidationFailed
from cmp.core.pagination import PageRequest
from cmp.core.permissions import Role
from cmp.core.security import file_hash
from cmp.db.pool import connection, transaction
from cmp.db.repositories import consent as consent_repo
from cmp.db.repositories import projects as repo
from cmp.domain import audit
from cmp.domain import consent as consent_service
from cmp.domain import projects as service
from cmp.domain.audit import Event
from cmp.schemas.common import Acknowledged, LongText, Out, Page, Schema, ShortText
from cmp.storage import read_upload, save_upload

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
    dco_user_uuid: UUID
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


class DcoAssign(Schema):
    dco_user_uuid: UUID


class SiteIn(Schema):
    site_label: Annotated[str, Field(min_length=1, max_length=160)]
    location: Annotated[str | None, Field(default=None, max_length=200)] = None
    processor_uuid: UUID | None = None
    #: The rig that reports from this site. Optional - a site can be registered
    #: before anyone has decided what will stand in it - but where given it must
    #: belong to the same processor.
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
            conn, page, role=principal.role, user_id=principal.user_id,
            project_status=project_status, q=q,
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
            dco_user_uuid=str(body.dco_user_uuid),
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
            conn, project_uuid=str(project_uuid), role=principal.role,
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
async def project_history(
    project_uuid: UUID, principal: ProjectReader
) -> list[dict[str, Any]]:
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


@router.post("/projects/{project_uuid}/dco", response_model=Acknowledged)
async def assign_dco(
    project_uuid: UUID, body: DcoAssign, principal: RequireDPO
) -> dict[str, Any]:
    async with transaction() as conn:
        await service.assign_dco(
            conn, project_uuid=str(project_uuid), dco_user_uuid=str(body.dco_user_uuid),
            actor_id=principal.user_id, role=principal.role,
        )
    return {"ok": True, "message": "Data Collection Owner assigned."}


@router.post("/projects/{project_uuid}/close")
async def close_project(
    project_uuid: UUID, body: TransitionRequest, principal: ProjectReader
) -> dict[str, Any]:
    if principal.role not in (Role.DPO, Role.DCO):
        raise Forbidden("Only a DPO or DCO may close a project")
    async with transaction() as conn:
        return await service.close(
            conn, project_uuid=str(project_uuid), actor_id=principal.user_id,
            role=principal.role, reason=body.reason,
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
            code="payload_too_large", field="proof",
        )
    if proof.content_type not in settings.allowed_proof_mime:
        raise ValidationFailed(
            f"Proof must be one of: {', '.join(settings.allowed_proof_mime)}", field="proof"
        )

    digest = file_hash(payload)
    stored = save_upload(payload, subdir="approvals", suggested_name=proof.filename or "proof")

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
            conn, event=Event.APPROVAL_PROOF_DOWNLOADED, entity_type="project_approval",
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
        return await repo.list_sites(conn, project["project_id"])


@router.post("/projects/{project_uuid}/sites", status_code=status.HTTP_201_CREATED)
async def add_site(
    project_uuid: UUID, body: SiteIn, principal: ProjectReader
) -> dict[str, Any]:
    """Register where collection will physically happen.

    The R&D User is included because they are the one who knows: they designed
    the study, they know which lab or clinic is running it, and which processor
    operates it. Leaving this to the DPO meant the DPO inventing a site to get
    past their own publication screen.
    """
    if principal.role not in (Role.DPO, Role.DCO, Role.RND_USER):
        raise Forbidden("Only a DPO, DCO or R&D User may add a site")
    async with transaction() as conn:
        return await service.add_site(
            conn,
            project_uuid=str(project_uuid),
            actor_id=principal.user_id,
            role=principal.role,
            site_label=body.site_label,
            location=body.location,
            processor_uuid=str(body.processor_uuid) if body.processor_uuid else None,
            source_uuid=str(body.source_uuid) if body.source_uuid else None,
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
            conn, event=Event.SITE_UPDATED, entity_type="project_site",
            entity_id=site["site_id"],
        )
    return updated


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
            conn, event=Event.SITE_DEACTIVATED, entity_type="project_site",
            entity_id=site["site_id"], detail={"links_revoked": revoked},
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
    if principal.role not in (Role.DPO, Role.DCO):
        raise Forbidden("Only a DPO or DCO may assign a Field Agent")

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
            conn, event=Event.SITE_AGENT_ASSIGNED, entity_type="consent_link",
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
