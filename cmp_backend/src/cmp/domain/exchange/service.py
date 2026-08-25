"""Exports and imports.

**Exports are two steps deliberately.** Generating writes the log and the line
rows; downloading is separate and repeatable. Regenerating to re-download would
write duplicate `export_line` rows and corrupt the disclosure record.

Two export types:

* **A - collection_pack.** Project, notice and purpose identifiers plus the
  site's consent link. No person rows, which is what makes it safe to email.
* **B - consented_list.** Only subjects whose current artefact grants at least
  one purpose, filtered by site, with a staleness header. Writes one
  `export_line` per subject.

**Imports are idempotent.** Rows upsert on (source, source_reference).
Re-submitting the same file accepts nothing and reports zero. `validate` is a dry
run - same parsing, same checks, nothing written - because a manifest arriving
from a third-party tool is the input you trust least, and finding out after a
partial write is worse than finding out before.
"""

from __future__ import annotations

import csv
import io
import json
from collections.abc import Iterable
from datetime import UTC, date, datetime
from typing import Any

from cmp.core.errors import Conflict, ImportRejected, NotFound, ValidationFailed
from cmp.core.logging import get_logger
from cmp.core.security import file_hash
from cmp.db.repositories import consent as consent_repo
from cmp.db.repositories import exchange as repo
from cmp.db.repositories import notices as notice_repo
from cmp.db.repositories import projects as project_repo
from cmp.db.repositories import registry as registry_repo
from cmp.db.sql import Conn
from cmp.domain.audit import service as audit
from cmp.domain.audit.service import Event

log = get_logger("cmp.exchange")

MAX_MANIFEST_ROWS = 50_000


# ------------------------------------------------------------------- exports
async def generate(
    conn: Conn,
    *,
    project_uuid: str,
    site_uuid: str,
    export_type: str,
    actor_id: int,
    role: str,
) -> dict[str, Any]:
    project = await project_repo.require(conn, project_uuid, role=role, user_id=actor_id)
    site = await project_repo.site_by_uuid(conn, site_uuid, role=role, user_id=actor_id)
    if not site or site["project_id"] != project["project_id"]:
        raise NotFound("Site")

    if export_type == "collection_pack":
        payload, rows, lines = await _collection_pack(conn, project, site)
    elif export_type == "consented_list":
        payload, rows, lines = await _consented_list(conn, project, site)
    else:
        raise ValidationFailed("Unknown export type", field="type")

    digest = file_hash(payload.encode("utf-8"))
    export = await repo.create_export(
        conn,
        project_id=project["project_id"],
        site_id=site["site_id"],
        export_type=export_type,
        exported_by=actor_id,
        row_count=rows,
        file_hash=digest,
    )
    written = await repo.add_export_lines(conn, export["export_id"], lines)

    await audit.record(
        conn,
        event=Event.EXPORT_GENERATED,
        entity_type="export_log",
        entity_id=export["export_id"],
        detail={
            "project": project_uuid,
            "site": site_uuid,
            "type": export_type,
            "row_count": rows,
            "lines": written,
            "sha256": digest,
        },
    )
    log.info("export.generated", type=export_type, rows=rows, lines=written)
    return {**export, "project_uuid": project_uuid, "site_uuid": site_uuid, "line_count": written}


async def _collection_pack(
    conn: Conn, project: dict[str, Any], site: dict[str, Any]
) -> tuple[str, int, list[tuple[int, int]]]:
    """Export A. Identifiers and the link - deliberately no person rows."""
    notices = await notice_repo.list_for_project(conn, project["project_id"])
    published = [n for n in notices if n["status"] == "published"]
    if not published:
        raise Conflict("The project has no published notice", code="no_published_notice")
    notice = max(published, key=lambda n: n["version"])

    purposes = await notice_repo.purposes_of(conn, notice["notice_id"])
    links = [
        link
        for link in await consent_repo.links_for_project(conn, project["project_id"])
        if str(link["site_uuid"]) == str(site["site_uuid"]) and link["status"] == "active"
    ]

    pack = {
        "generated_at": datetime.now(UTC).isoformat(),
        "project": {
            "uuid": str(project["project_uuid"]),
            "name": project["project_name"],
            "status": project["project_status"],
        },
        "site": {
            "uuid": str(site["site_uuid"]),
            "label": site["site_label"],
            "location": site["location"],
        },
        "notice": {
            "uuid": str(notice["notice_uuid"]),
            "code": notice["notice_code"],
            "version": notice["version"],
            "published_at": notice["published_at"].isoformat() if notice["published_at"] else None,
            "recipients_text": notice["recipients_text"],
        },
        "purposes": [
            {
                "uuid": str(p["purpose_uuid"]),
                "code": p["purpose_code"],
                "name": p["name"],
                "lawful_basis": p["lawful_basis"],
                "data_categories": p["data_categories"],
                "is_mandatory": p["is_mandatory"],
            }
            for p in purposes
        ],
        "consent_links": [
            {
                "uuid": str(link_["link_uuid"]),
                "expires_at": link_["expires_at"].isoformat(),
                "uses_remaining": (
                    None
                    if link_["max_uses"] is None
                    else max(0, link_["max_uses"] - link_["use_count"])
                ),
            }
            for link_ in links
        ],
        "contains_personal_data": False,
    }
    return json.dumps(pack, indent=2, default=str), len(purposes), []


async def _consented_list(
    conn: Conn, project: dict[str, Any], site: dict[str, Any]
) -> tuple[str, int, list[tuple[int, int]]]:
    """Export B. Person rows, and therefore one export_line each."""
    subjects = await repo.consented_subjects(
        conn, project_id=project["project_id"], site_id=site["site_id"]
    )

    buf = io.StringIO()
    writer = csv.writer(buf, lineterminator="\n")
    writer.writerow(
        [
            "subject_uuid",
            "full_name",
            "email",
            "mobile",
            "organization_id",
            "person_type",
            "consent_uuid",
            "consented_at",
            "notice_code",
            "notice_version",
            "notice_content_sha256",
            "granted_purposes",
        ]
    )
    for s in subjects:
        writer.writerow(
            [
                s["subject_uuid"],
                s["full_name"],
                s["email"],
                s["mobile"] or "",
                s["organization_id"] or "",
                s["person_type"] or "",
                s["consent_uuid"],
                s["affirmative_action_at"].isoformat(),
                s["notice_code"],
                s["notice_version"],
                s["notice_content_hash"],
                "|".join(s["granted_purposes"] or []),
            ]
        )

    lines = [(s["auth_user_id"], s["consent_id"]) for s in subjects]
    return buf.getvalue(), len(subjects), lines


async def render(conn: Conn, export: dict[str, Any]) -> tuple[str, str, str]:
    """Re-render a previously generated export for download.

    Regenerated from the same query rather than stored as a blob. The `file_hash`
    recorded at generation is what proves the content has not drifted - a
    mismatch is surfaced, not hidden, because a changed export is a changed
    disclosure.
    """
    project = await project_repo.by_uuid(conn, str(export["project_uuid"]), role="dpo", user_id=0)
    site = await project_repo.site_by_uuid(conn, str(export["site_uuid"]), role="dpo", user_id=0)
    if not project or not site:
        raise NotFound("Export source")

    if export["export_type"] == "collection_pack":
        payload, _, _ = await _collection_pack(conn, project, site)
        return payload, "application/json", "json"
    payload, _, _ = await _consented_list(conn, project, site)
    return payload, "text/csv", "csv"


# ------------------------------------------------------------------- imports
REQUIRED_COLUMNS = (
    "source_collection_ref",
    "source_asset_ref",
    "asset_type",
    "collected_on",
    "subject_role",
)
OPTIONAL_COLUMNS = ("consent_uuid", "storage_ref", "agent_ref", "site_uuid", "declared_asset_count")

VALID_ASSET_TYPES = {"image", "video", "audio", "sensor", "document", "other"}
VALID_SUBJECT_ROLES = {"consented", "incidental", "unidentified"}


def parse_manifest(raw: bytes) -> tuple[list[dict[str, str]], list[dict[str, Any]]]:
    """Parse and shape-check. Returns (rows, errors). Writes nothing."""
    errors: list[dict[str, Any]] = []
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        return [], [{"row": 0, "field": "file", "error": "File is not valid UTF-8"}]

    reader = csv.DictReader(io.StringIO(text))
    if reader.fieldnames is None:
        return [], [{"row": 0, "field": "file", "error": "File has no header row"}]

    header = {(h or "").strip() for h in reader.fieldnames}
    missing = [c for c in REQUIRED_COLUMNS if c not in header]
    if missing:
        return [], [
            {"row": 0, "field": c, "error": f"Required column '{c}' is missing"} for c in missing
        ]

    unknown = sorted(header - set(REQUIRED_COLUMNS) - set(OPTIONAL_COLUMNS))
    if unknown:
        errors.append(
            {
                "row": 0,
                "field": unknown[0],
                "error": f"Unknown column(s): {', '.join(unknown)}",
            }
        )

    rows: list[dict[str, str]] = []
    for i, raw_row in enumerate(reader, start=2):
        if i - 1 > MAX_MANIFEST_ROWS:
            errors.append(
                {
                    "row": i,
                    "field": "file",
                    "error": f"Manifest exceeds {MAX_MANIFEST_ROWS} rows",
                }
            )
            break
        rows.append({k: (v or "").strip() for k, v in raw_row.items() if k})
    return rows, errors


def validate_rows(rows: Iterable[dict[str, str]]) -> list[dict[str, Any]]:
    """Field-level validation. Same checks the real import runs."""
    errors: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()

    for i, row in enumerate(rows, start=2):
        for field in REQUIRED_COLUMNS:
            if not row.get(field):
                errors.append({"row": i, "field": field, "error": "Required value is empty"})

        asset_type = row.get("asset_type", "")
        if asset_type and asset_type not in VALID_ASSET_TYPES:
            errors.append(
                {
                    "row": i,
                    "field": "asset_type",
                    "error": f"Must be one of: {', '.join(sorted(VALID_ASSET_TYPES))}",
                }
            )

        subject_role = row.get("subject_role", "")
        if subject_role and subject_role not in VALID_SUBJECT_ROLES:
            errors.append(
                {
                    "row": i,
                    "field": "subject_role",
                    "error": f"Must be one of: {', '.join(sorted(VALID_SUBJECT_ROLES))}",
                }
            )

        # The rule the schema also enforces, checked here so the report names the
        # row rather than failing the whole batch on a constraint violation.
        if subject_role == "consented" and not row.get("consent_uuid"):
            errors.append(
                {
                    "row": i,
                    "field": "consent_uuid",
                    "error": "A consented subject requires a consent_uuid",
                }
            )
        if subject_role in ("incidental", "unidentified") and row.get("consent_uuid"):
            errors.append(
                {
                    "row": i,
                    "field": "consent_uuid",
                    "error": f"A {subject_role} subject must not carry a consent_uuid",
                }
            )

        if row.get("collected_on"):
            try:
                parsed = date.fromisoformat(row["collected_on"])
                if parsed > datetime.now(UTC).date():
                    errors.append(
                        {
                            "row": i,
                            "field": "collected_on",
                            "error": "Collection date is in the future",
                        }
                    )
            except ValueError:
                errors.append(
                    {
                        "row": i,
                        "field": "collected_on",
                        "error": "Must be YYYY-MM-DD",
                    }
                )

        key = (row.get("source_asset_ref", ""), row.get("consent_uuid", ""))
        if key in seen and key[0]:
            errors.append(
                {
                    "row": i,
                    "field": "source_asset_ref",
                    "error": "Duplicate asset/subject pair within this file",
                }
            )
        seen.add(key)

    return errors


async def validate(
    conn: Conn,
    *,
    source_uuid: str,
    project_uuid: str | None,
    raw: bytes,
    role: str,
    actor_id: int,
) -> dict[str, Any]:
    """Dry run. Same parsing, same checks, nothing written."""
    source = await registry_repo.source_by_uuid(conn, source_uuid)
    if not source:
        raise NotFound("Data source")
    if source["status"] != "active":
        raise Conflict("That data source is suspended", code="source_suspended")

    rows, parse_errors = parse_manifest(raw)
    errors = [*parse_errors, *validate_rows(rows)]

    digest = file_hash(raw)
    prior = await repo.batch_by_file_hash(conn, source_id=source["source_id"], file_hash=digest)

    return {
        "valid": not errors,
        "declared_rows": len(rows),
        "error_count": len(errors),
        "errors": errors[:200],
        "file_sha256": digest,
        "already_imported": bool(prior),
        "previous_batch_uuid": str(prior["batch_uuid"]) if prior else None,
    }


async def import_manifest(
    conn: Conn,
    *,
    source_uuid: str,
    project_uuid: str,
    file_name: str,
    raw: bytes,
    actor_id: int,
    role: str,
) -> dict[str, Any]:
    """Ingest a manifest into collection / data_asset / asset_consent."""
    source = await registry_repo.source_by_uuid(conn, source_uuid)
    if not source:
        raise NotFound("Data source")
    if source["status"] != "active":
        raise Conflict("That data source is suspended", code="source_suspended")

    project = await project_repo.require(conn, project_uuid, role=role, user_id=actor_id)
    digest = file_hash(raw)

    # Idempotency short-circuit: the same bytes from the same source were already
    # accepted. Report zero rather than re-running the upserts.
    prior = await repo.batch_by_file_hash(conn, source_id=source["source_id"], file_hash=digest)
    if prior:
        return {
            "batch_uuid": prior["batch_uuid"],
            "status": prior["status"],
            "accepted_rows": 0,
            "rejected_rows": 0,
            "declared_rows": 0,
            "idempotent_replay": True,
            "message": "This file has already been imported. Nothing was written.",
        }

    rows, parse_errors = parse_manifest(raw)
    errors = [*parse_errors, *validate_rows(rows)]

    batch = await repo.create_batch(
        conn,
        source_id=source["source_id"],
        project_id=project["project_id"],
        file_name=file_name,
        file_hash=digest,
        declared_rows=len(rows),
        imported_by=actor_id,
    )

    if errors and not rows:
        finished = await repo.finish_batch(
            conn,
            batch["batch_id"],
            accepted=0,
            rejected=len(errors),
            status="rejected",
            error_report=json.dumps(errors[:200]),
        )
        await audit.record(
            conn,
            event=Event.IMPORT_REJECTED,
            entity_type="import_batch",
            entity_id=batch["batch_id"],
            detail={"file": file_name, "errors": len(errors), "sha256": digest},
        )
        raise ImportRejected(
            "The manifest could not be parsed",
            details={"batch_uuid": str(finished["batch_uuid"]), "errors": errors[:50]},
        )

    accepted, rejected = 0, list(errors)
    bad_rows = {e["row"] for e in errors}

    for i, row in enumerate(rows, start=2):
        if i in bad_rows:
            continue
        try:
            await _ingest_row(
                conn,
                row=row,
                source_id=source["source_id"],
                project_id=project["project_id"],
                batch_id=batch["batch_id"],
            )
            accepted += 1
        except (ValidationFailed, NotFound, Conflict) as exc:
            rejected.append(
                {"row": i, "field": getattr(exc, "field", None) or "-", "error": exc.message}
            )

    status = "accepted" if not rejected else ("partial" if accepted else "rejected")
    finished = await repo.finish_batch(
        conn,
        batch["batch_id"],
        accepted=accepted,
        rejected=len(rejected),
        status=status,
        error_report=json.dumps(rejected[:200]) if rejected else None,
    )

    await audit.record(
        conn,
        event=Event.IMPORT_ACCEPTED if accepted else Event.IMPORT_REJECTED,
        entity_type="import_batch",
        entity_id=batch["batch_id"],
        detail={
            "file": file_name,
            "accepted": accepted,
            "rejected": len(rejected),
            "status": status,
            "sha256": digest,
        },
    )
    log.info("import.finished", accepted=accepted, rejected=len(rejected), status=status)

    return {
        "batch_uuid": finished["batch_uuid"],
        "status": status,
        "declared_rows": len(rows),
        "accepted_rows": accepted,
        "rejected_rows": len(rejected),
        "errors": rejected[:50],
        "idempotent_replay": False,
    }


async def _ingest_row(
    conn: Conn, *, row: dict[str, str], source_id: int, project_id: int, batch_id: int
) -> None:
    site_id = None
    if row.get("site_uuid"):
        site = await project_repo.site_by_uuid(conn, row["site_uuid"], role="dpo", user_id=0)
        if not site or site["project_id"] != project_id:
            raise ValidationFailed("site_uuid is not a site of this project", field="site_uuid")
        site_id = site["site_id"]

    collection, _ = await repo.upsert_collection(
        conn,
        source_id=source_id,
        source_collection_ref=row["source_collection_ref"],
        project_id=project_id,
        site_id=site_id,
        batch_id=batch_id,
        agent_ref=row.get("agent_ref") or None,
        collected_on=date.fromisoformat(row["collected_on"]),
        declared_asset_count=int(row.get("declared_asset_count") or 0),
    )

    subject_role = row["subject_role"]
    consent_id = None
    if subject_role == "consented":
        artefact = await consent_repo.artefact_by_uuid(conn, row["consent_uuid"])
        if not artefact:
            raise NotFound("Consent artefact")
        if artefact["project_id"] != project_id:
            raise ValidationFailed(
                "That consent belongs to a different project", field="consent_uuid"
            )
        consent_id = artefact["consent_id"]

    # An asset with any non-consented subject is flagged, which is what makes the
    # redact-before-release rule enforceable against people the system knows are
    # present but cannot identify.
    asset, _ = await repo.upsert_asset(
        conn,
        source_id=source_id,
        source_asset_ref=row["source_asset_ref"],
        collection_id=collection["collection_id"],
        asset_type=row["asset_type"],
        storage_ref=row.get("storage_ref") or None,
        has_unmapped_subjects=subject_role != "consented",
    )

    if not await repo.asset_subject_exists(conn, asset_id=asset["asset_id"], consent_id=consent_id):
        await repo.link_asset_subject(
            conn,
            asset_id=asset["asset_id"],
            consent_id=consent_id,
            subject_role=subject_role,
            disposition="active",
        )
