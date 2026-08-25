"""Exports (5), imports (5), collections and assets (6).

Exports are two steps: generating writes the log and the line rows; downloading
is separate and repeatable. Regenerating to re-download would write duplicate
`export_line` rows and corrupt the disclosure record.
"""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, Query, Request, Response, UploadFile, status
from pydantic import Field

from cmp.api.dependencies import CurrentUser, Paging, RequireResource, reject_unknown_filters
from cmp.core.config import settings
from cmp.core.errors import BadRequest, Forbidden, NotFound, ValidationFailed
from cmp.core.pagination import PageRequest
from cmp.core.permissions import Role
from cmp.db.pool import connection, transaction
from cmp.db.repositories import exchange as repo
from cmp.db.repositories import projects as project_repo
from cmp.domain.audit import service as audit
from cmp.domain.audit.service import Event
from cmp.domain.exchange import service as service
from cmp.schemas.common import Out, Page, Schema

router = APIRouter(tags=["exchange"])

batch_paging = Paging(repo.BATCH_SORTS, "-received_at")
collection_paging = Paging(repo.COLLECTION_SORTS, "-collected_on")

ExportActor = Annotated[Any, Depends(RequireResource("export", write=True))]
ExportReader = Annotated[Any, Depends(RequireResource("export"))]
ImportActor = Annotated[Any, Depends(RequireResource("import", write=True))]
CollectionReader = Annotated[Any, Depends(RequireResource("collection"))]


class ExportRequest(Schema):
    type: str = Field(description="collection_pack or consented_list")
    site: UUID


class ExportOut(Out):
    export_uuid: UUID
    export_type: str
    exported_at: datetime
    row_count: int
    file_hash: str
    line_count: int | None = None
    site_uuid: UUID | None = None
    site_label: str | None = None
    exported_by_name: str | None = None


export_paging = Paging(repo.EXPORT_SORTS, "-exported_at")


class ExportListRow(ExportOut):
    project_uuid: UUID
    project_name: str


class CollectionListRow(Out):
    collection_uuid: UUID
    source_collection_ref: str
    collected_on: Any
    declared_asset_count: int
    mapped_asset_count: int
    unaccounted: int
    agent_ref: str | None = None
    created_at: datetime
    source_uuid: UUID
    source_code: str
    source_name: str
    project_uuid: UUID
    project_name: str
    site_uuid: UUID | None = None
    site_label: str | None = None


class CollectionOut(CollectionListRow):
    """One collection, in full.

    Declared rather than returned as a bare dict because the scoped query has to
    select `collection_id` for its follow-up lookups, and an internal surrogate
    key has no business on the wire.
    """

    batch_uuid: UUID
    # The list computes this; the detail query does not, so it is derived below.
    unaccounted: int


class CollectionAssetOut(Out):
    asset_uuid: UUID
    source_asset_ref: str
    asset_type: str
    storage_ref: str
    has_unmapped_subjects: bool
    created_at: datetime
    subject_count: int
    #: Rows with no consent behind them - someone in frame who never consented.
    bystander_count: int


class ImportBatchOut(Out):
    batch_uuid: UUID
    file_name: str
    file_hash: str
    declared_rows: int
    accepted_rows: int
    rejected_rows: int
    status: str
    received_at: datetime
    source_uuid: UUID
    source_code: str
    source_name: str
    project_uuid: UUID | None = None
    project_name: str | None = None
    imported_by_uuid: UUID
    imported_by_name: str


# ===================================================== cross-project listings
@router.get("/exports", response_model=Page[ExportListRow], summary="The disclosure register")
async def list_all_exports(
    request: Request,
    principal: ExportReader,
    page: Annotated[PageRequest, Depends(export_paging)],
    export_type: Annotated[str | None, Query(alias="type")] = None,
) -> dict[str, Any]:
    """Every export in scope: what left, when, to which site, and how many people.

    This is the register that makes s.11(1)(b) answerable at the organisation
    level rather than one project at a time.
    """
    reject_unknown_filters(request, {"type"})
    async with connection() as conn:
        items, cursor, total = await repo.list_all_exports(
            conn, page, role=principal.role, user_id=principal.user_id,
            export_type=export_type,
        )
    return {"items": items, "next_cursor": cursor, "total": total}


@router.get(
    "/collections",
    response_model=Page[CollectionListRow],
    summary="All collections, with their reconciliation gap",
)
async def list_all_collections(
    principal: CollectionReader,
    page: Annotated[PageRequest, Depends(collection_paging)],
) -> dict[str, Any]:
    """`unaccounted` is declared minus mapped, carried in the list itself.

    The failure mode this exists for is 500 declared and 480 mapped. Surfacing
    the gap here means nobody has to open each collection to find the one with
    twenty assets in an unlawful state.
    """
    async with connection() as conn:
        items, cursor, total = await repo.list_all_collections(
            conn, page, role=principal.role, user_id=principal.user_id
        )
    return {"items": items, "next_cursor": cursor, "total": total}


# ================================================================== exports
@router.post(
    "/projects/{project_uuid}/exports",
    response_model=ExportOut,
    status_code=status.HTTP_201_CREATED,
)
async def generate_export(
    project_uuid: UUID, body: ExportRequest, principal: ExportActor
) -> dict[str, Any]:
    """Export A carries no person rows, which is what makes it safe to email.
    Export B carries person rows, and therefore writes one export_line each."""
    if body.type not in ("collection_pack", "consented_list"):
        raise ValidationFailed(
            "type must be collection_pack or consented_list", field="type"
        )
    async with transaction() as conn:
        return await service.generate(
            conn,
            project_uuid=str(project_uuid),
            site_uuid=str(body.site),
            export_type=body.type,
            actor_id=principal.user_id,
            role=principal.role,
        )


@router.get("/projects/{project_uuid}/exports", response_model=list[ExportOut])
async def list_exports(project_uuid: UUID, principal: ExportReader) -> list[dict[str, Any]]:
    async with connection() as conn:
        project = await project_repo.require(
            conn, str(project_uuid), role=principal.role, user_id=principal.user_id
        )
        return await repo.exports_for_project(conn, project["project_id"])


@router.get("/exports/{export_uuid}", response_model=ExportOut)
async def get_export(export_uuid: UUID, principal: ExportReader) -> dict[str, Any]:
    async with connection() as conn:
        export = await repo.export_by_uuid(
            conn, str(export_uuid), role=principal.role, user_id=principal.user_id
        )
        if not export:
            raise NotFound("Export")
        return export


@router.get("/exports/{export_uuid}/download")
async def download_export(export_uuid: UUID, principal: ExportReader) -> Response:
    """Repeatable, and it does not write a new disclosure record.

    The staleness header is deliberate: a consented list is true at the moment it
    was generated, and somebody acting on a three-week-old file needs to know
    that withdrawals since then are not reflected in it.
    """
    async with transaction() as conn:
        export = await repo.export_by_uuid(
            conn, str(export_uuid), role=principal.role, user_id=principal.user_id
        )
        if not export:
            raise NotFound("Export")

        payload, media_type, ext = await service.render(conn, export)
        await audit.record(
            conn, event=Event.EXPORT_DOWNLOADED, entity_type="export_log",
            entity_id=export["export_id"],
        )

    from cmp.core.security import file_hash

    generated_at = export["exported_at"]
    age_days = (datetime.now(generated_at.tzinfo) - generated_at).days
    filename = f"{export['export_type']}-{export['export_uuid']}.{ext}"

    return Response(
        content=payload,
        media_type=media_type,
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "X-Export-Generated-At": generated_at.isoformat(),
            "X-Export-Age-Days": str(age_days),
            "X-Recorded-SHA256": export["file_hash"],
            "X-Content-SHA256": file_hash(payload.encode("utf-8")),
            "X-Export-Staleness-Warning": (
                f"Generated {age_days} day(s) ago. Withdrawals since then are not "
                "reflected. Regenerate before acting on it."
            ),
        },
    )


@router.get("/exports/{export_uuid}/lines", summary="Who was in this file (s.11(1)(b))")
async def export_lines(export_uuid: UUID, principal: ExportReader) -> list[dict[str, Any]]:
    async with connection() as conn:
        export = await repo.export_by_uuid(
            conn, str(export_uuid), role=principal.role, user_id=principal.user_id
        )
        if not export:
            raise NotFound("Export")
        return await repo.export_lines(conn, export["export_id"])


# ================================================================== imports
async def _read_manifest(manifest: UploadFile) -> bytes:
    payload = await manifest.read()
    if not payload:
        raise ValidationFailed("The manifest is empty", field="manifest")
    if len(payload) > settings.max_upload_bytes:
        raise BadRequest(
            f"Manifest exceeds {settings.max_upload_bytes // (1024 * 1024)} MB",
            code="payload_too_large", field="manifest",
        )
    if manifest.content_type not in settings.allowed_manifest_mime:
        raise ValidationFailed(
            f"Manifest must be one of: {', '.join(settings.allowed_manifest_mime)}",
            field="manifest",
        )
    return payload


@router.post("/imports/validate", summary="Dry run - nothing is written")
async def validate_import(
    principal: ImportActor,
    source: Annotated[UUID, Form()],
    manifest: Annotated[UploadFile, File()],
    project: Annotated[UUID | None, Form()] = None,
) -> dict[str, Any]:
    """Same parsing, same checks, nothing written.

    A manifest arriving from a third-party tool is the input you trust least, and
    finding out after a partial write is worse than finding out before.
    """
    payload = await _read_manifest(manifest)
    async with connection() as conn:
        result = await service.validate(
            conn,
            source_uuid=str(source),
            project_uuid=str(project) if project else None,
            raw=payload,
            role=principal.role,
            actor_id=principal.user_id,
        )
    async with transaction() as conn:
        await audit.record(
            conn, event=Event.IMPORT_VALIDATED, entity_type="import_batch", entity_id=0,
            detail={"source": str(source), "valid": result["valid"],
                    "errors": result["error_count"], "sha256": result["file_sha256"]},
        )
    return result


@router.post("/imports", status_code=status.HTTP_201_CREATED)
async def create_import(
    principal: ImportActor,
    source: Annotated[UUID, Form()],
    project: Annotated[UUID, Form()],
    manifest: Annotated[UploadFile, File()],
) -> dict[str, Any]:
    """Idempotent: re-submitting the same file accepts nothing and reports zero."""
    payload = await _read_manifest(manifest)
    async with transaction() as conn:
        return await service.import_manifest(
            conn,
            source_uuid=str(source),
            project_uuid=str(project),
            file_name=manifest.filename or "manifest.csv",
            raw=payload,
            actor_id=principal.user_id,
            role=principal.role,
        )


@router.get("/imports")
async def list_imports(
    request: Request,
    principal: CurrentUser,
    page: Annotated[PageRequest, Depends(batch_paging)],
    source: Annotated[UUID | None, Query()] = None,
    batch_status: Annotated[str | None, Query(alias="status")] = None,
) -> dict[str, Any]:
    reject_unknown_filters(request, {"source", "status"})
    async with connection() as conn:
        items, cursor, total = await repo.list_batches(
            conn, page, role=principal.role, user_id=principal.user_id,
            source_uuid=str(source) if source else None, status=batch_status,
        )
    return {"items": items, "next_cursor": cursor, "total": total}


@router.get("/imports/{batch_uuid}", response_model=ImportBatchOut)
async def get_import(batch_uuid: UUID, principal: CurrentUser) -> dict[str, Any]:
    async with connection() as conn:
        batch = await repo.batch_by_uuid(
            conn, str(batch_uuid), role=principal.role, user_id=principal.user_id
        )
        if not batch:
            raise NotFound("Import batch")
        batch.pop("error_report", None)
        return batch


@router.get("/imports/{batch_uuid}/errors")
async def import_errors(batch_uuid: UUID, principal: CurrentUser) -> dict[str, Any]:
    import json

    async with connection() as conn:
        batch = await repo.batch_by_uuid(
            conn, str(batch_uuid), role=principal.role, user_id=principal.user_id
        )
        if not batch:
            raise NotFound("Import batch")

    raw = batch.get("error_report")
    errors = json.loads(raw) if raw else []
    return {
        "batch_uuid": batch["batch_uuid"],
        "status": batch["status"],
        "declared_rows": batch["declared_rows"],
        "accepted_rows": batch["accepted_rows"],
        "rejected_rows": batch["rejected_rows"],
        "errors": errors,
    }


# =================================================== collections and assets
@router.get("/projects/{project_uuid}/collections")
async def list_collections(
    project_uuid: UUID,
    principal: CollectionReader,
    page: Annotated[PageRequest, Depends(collection_paging)],
) -> dict[str, Any]:
    async with connection() as conn:
        project = await project_repo.require(
            conn, str(project_uuid), role=principal.role, user_id=principal.user_id
        )
        items, cursor, total = await repo.list_collections(
            conn, page, project_id=project["project_id"]
        )
    return {"items": items, "next_cursor": cursor, "total": total}


@router.get("/collections/{collection_uuid}", response_model=CollectionOut)
async def get_collection(
    collection_uuid: UUID, principal: CollectionReader
) -> dict[str, Any]:
    async with connection() as conn:
        collection = await repo.collection_by_uuid(
            conn, str(collection_uuid), role=principal.role, user_id=principal.user_id
        )
        if not collection:
            raise NotFound("Collection")
        # Declared minus mapped. Computed here rather than in SQL because the
        # detail query already has both numbers, and a third subquery to restate
        # a subtraction is a scan nobody needs.
        collection["unaccounted"] = max(
            0, collection["declared_asset_count"] - collection["mapped_asset_count"]
        )
        return collection


@router.get("/collections/{collection_uuid}/assets", response_model=list[CollectionAssetOut])
async def collection_assets(
    collection_uuid: UUID, principal: CollectionReader
) -> list[dict[str, Any]]:
    async with connection() as conn:
        collection = await repo.collection_by_uuid(
            conn, str(collection_uuid), role=principal.role, user_id=principal.user_id
        )
        if not collection:
            raise NotFound("Collection")
        return await repo.assets_of_collection(conn, collection["collection_id"])


@router.get(
    "/collections/{collection_uuid}/exceptions",
    summary="Declared against mapped - the control that makes direct collection workable",
)
async def collection_exceptions(
    collection_uuid: UUID, principal: CollectionReader
) -> dict[str, Any]:
    """The failure mode is not a rejected file.

    It is 500 declared and 480 mapped, with 20 sitting in an unlawful state
    nobody sees. This is the endpoint that surfaces those 20.
    """
    async with connection() as conn:
        collection = await repo.collection_by_uuid(
            conn, str(collection_uuid), role=principal.role, user_id=principal.user_id
        )
        if not collection:
            raise NotFound("Collection")
        return await repo.collection_exceptions(conn, collection["collection_id"])


@router.get("/assets/{asset_uuid}")
async def get_asset(asset_uuid: UUID, principal: CollectionReader) -> dict[str, Any]:
    async with connection() as conn:
        asset = await repo.asset_by_uuid(
            conn, str(asset_uuid), role=principal.role, user_id=principal.user_id
        )
        if not asset:
            raise NotFound("Asset")
        return asset


@router.get("/assets/{asset_uuid}/subjects", summary="One row per subject, bystanders included")
async def asset_subjects(asset_uuid: UUID, principal: CurrentUser) -> list[dict[str, Any]]:
    """Includes bystanders with a null consent id.

    Multi-subject capture includes people in frame who never consented. If the
    row cannot exist, a redact-before-release rule cannot be enforced against
    someone the system does not know is there (INV-12).
    """
    if principal.role not in (Role.DPO, Role.DCO):
        raise Forbidden("Your role may not read asset subjects")
    async with connection() as conn:
        asset = await repo.asset_by_uuid(
            conn, str(asset_uuid), role=principal.role, user_id=principal.user_id
        )
        if not asset:
            raise NotFound("Asset")
        return await repo.asset_subjects(conn, asset["asset_id"])
