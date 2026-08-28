"""Exports and imports.

**Exports are two steps deliberately.** Generating writes the log and the line
rows; downloading is separate and repeatable. Regenerating to re-download would
write duplicate `export_line` rows and corrupt the disclosure record.

**One export, per project, as a CSV.** There were two and the split asked the
wrong question of the person using it: a JSON pack with the context and no
people, and a CSV with the people and no context. The agent at the collection
point needs both on the same row - whom the consent is against, and which notice
version they agreed to - and was joining two files by hand to get it.

Every row carries the project, the notice and the site alongside the person, so
it opens in a spreadsheet and filters without preparation. Consented, partial
and withdrawn rows are included with a status column; a withdrawal is the row an
agent most needs to see, and it is invisible on a consented-only list.

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
from cmp.core.security import file_hash, unseal_token
from cmp.db.repositories import consent as consent_repo
from cmp.db.repositories import exchange as repo
from cmp.db.repositories import projects as project_repo
from cmp.db.repositories import registry as registry_repo
from cmp.db.sql import Conn
from cmp.domain.audit import service as audit
from cmp.domain.audit.service import Event
from cmp.domain.consent.service import link_path as consent_link_path

log = get_logger("cmp.exchange")

MAX_MANIFEST_ROWS = 50_000


# ------------------------------------------------------------------- exports
async def generate(
    conn: Conn,
    *,
    project_uuid: str,
    actor_id: int,
    role: str,
) -> dict[str, Any]:
    """Generate this project's export and record what it disclosed.

    No type and no site. The type is gone because there is one; the site is gone
    because a project is the thing people talk about and which of its sites a
    row came from is a column.

    What the caller may see still decides the contents: `project_consents` is
    scoped by site ownership, so a DCO's export holds their campus's people and
    an RCO's holds theirs. Generating and downloading stay two steps - a
    re-download must not write a second disclosure record.
    """
    project = await project_repo.require(conn, project_uuid, role=role, user_id=actor_id)

    payload, rows, lines = await _project_export(conn, project, role=role, user_id=actor_id)
    digest = file_hash(payload.encode("utf-8"))
    export = await repo.create_export(
        conn,
        project_id=project["project_id"],
        # No single site: the export covers every one the exporter could see,
        # and each row names its own.
        site_id=None,
        export_type="project_export",
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
            "type": "project_export",
            "row_count": rows,
            "lines": written,
            "sha256": digest,
        },
    )
    log.info("export.generated", project=project_uuid, rows=rows, lines=written)
    return {**export, "project_uuid": project_uuid, "line_count": written}


#: The columns, in the order somebody reads them: what this is, who it is about,
#: what they agreed to, and what they were shown when they agreed.
EXPORT_COLUMNS = (
    "project_name",
    "project_uuid",
    "site_label",
    "source_code",
    # Which link the consent came in through, whether that channel is still
    # open, and the address itself.
    #
    # The URL is here because the file exists to be handed to whoever collects,
    # and an identifier they cannot open is not a link. It is a real credential,
    # which is why the export writes a disclosure row and the dialog says so
    # before generating. Empty for links minted before they were made
    # recoverable - their tokens were never kept.
    "consent_link_uuid",
    "consent_link_url",
    "link_status",
    "link_expires_at",
    "consent_uuid",
    "full_name",
    "email",
    "mobile",
    "organization_id",
    "person_type",
    "consent_status",
    "granted_purposes",
    "consented_at",
    "notice_code",
    "notice_version",
    "notice_content_sha256",
)


def _link_url(row: dict[str, Any]) -> str:
    """The shareable address, where it can still be recovered.

    A path rather than an absolute URL: the host a link is served on is
    deployment configuration, and baking one into a file that outlives the
    deployment produces a document that is confidently wrong.
    """
    token = unseal_token(row.get("token_sealed"))
    return consent_link_path(token) if token else ""


def _consent_status(row: dict[str, Any]) -> str:
    """The word an agent acts on.

    `partial` rather than `consented` where anything was refused, because an
    agent who reads "consented" and collects everything has collected something
    that was refused - and the granted_purposes column is the detail behind it.
    """
    if row["is_withdrawal"]:
        return "withdrawn"
    return "consented" if not row["refused_count"] else "partial"


def _row_for(project: dict[str, Any], c: dict[str, Any]) -> list[Any]:
    return [
        project["project_name"],
        str(project["project_uuid"]),
        c["site_label"],
        c["source_code"] or "",
        str(c["link_uuid"]),
        _link_url(c),
        c["link_status"],
        c["link_expires_at"].isoformat() if c["link_expires_at"] else "",
        str(c["consent_uuid"]),
        c["full_name"],
        c["email"],
        c["mobile"] or "",
        c["organization_id"] or "",
        c["person_type"] or "",
        _consent_status(c),
        "|".join(c["granted_purposes"] or []),
        c["affirmative_action_at"].isoformat(),
        c["notice_code"],
        c["notice_version"],
        c["notice_content_hash"],
    ]


def _write_csv(project: dict[str, Any], consents: list[dict[str, Any]]) -> str:
    buf = io.StringIO()
    writer = csv.writer(buf, lineterminator="\n")
    writer.writerow(EXPORT_COLUMNS)

    if not consents:
        # One row of context rather than a bare header. A file containing only
        # column names reads as a broken export; this one says which project it
        # is and that nobody has consented yet.
        row: list[Any] = [""] * len(EXPORT_COLUMNS)
        row[0] = project["project_name"]
        row[1] = str(project["project_uuid"])
        writer.writerow(row)
        return buf.getvalue()

    for c in consents:
        writer.writerow(_row_for(project, c))
    return buf.getvalue()


async def _project_export(
    conn: Conn, project: dict[str, Any], *, role: str, user_id: int
) -> tuple[str, int, list[tuple[int, int]]]:
    """The CSV, and one `export_line` per person disclosed.

    The line rows are the disclosure record - who was named in what, and when.
    Withdrawn people are in it too: their details left the building in this
    file, and a record that omitted them would understate what was disclosed.
    """
    consents = await repo.project_consents(
        conn, project_id=project["project_id"], role=role, user_id=user_id
    )
    payload = _write_csv(project, consents)
    lines = [(c["auth_user_id"], c["consent_id"]) for c in consents]
    return payload, len(consents), lines


async def render(conn: Conn, export: dict[str, Any]) -> tuple[str, str, str]:
    """Re-render a generated export for download.

    Rebuilt from the export's own `export_line` rows, not by re-running the
    query. Re-running would return whatever matches *now* - a consent given
    after the export would appear in a download of it - and it would rebuild
    against whoever is downloading, which is how one collection owner's file
    could come to hold another's people.

    The recorded `file_hash` still proves the content has not drifted: a person
    renamed since the export changes the rendered bytes and the comparison
    catches it, which is the case the hash exists for.
    """
    project = await project_repo.by_uuid(conn, str(export["project_uuid"]), role="dpo", user_id=0)
    if not project:
        raise NotFound("Export source")

    # Older per-site exports predate this and were JSON or a different CSV.
    # Re-rendering them through today's builder would produce a file that never
    # existed, so they are served as what they are: a record that the export
    # happened, with its rows.
    consents = await repo.consents_in_export(conn, export["export_id"])
    return _write_csv(project, consents), "text/csv", "csv"


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


#: What each column is for, in the words somebody filling the file in needs.
#:
#: Kept beside the column tuples so a column added above without a description
#: below is visible in one screen rather than discovered by a user.
COLUMN_HELP: dict[str, str] = {
    "source_collection_ref": "Your reference for the collection session, e.g. a batch or run id.",
    "source_asset_ref": "Your reference for the individual file. Unique within the collection.",
    "asset_type": f"One of: {', '.join(sorted(VALID_ASSET_TYPES))}.",
    "collected_on": "The date the data was captured, as YYYY-MM-DD. Not the upload date.",
    "subject_role": (
        f"One of: {', '.join(sorted(VALID_SUBJECT_ROLES))}. "
        "'consented' needs a consent_uuid; 'incidental' is somebody who happened to be "
        "in frame; 'unidentified' is a subject nobody has matched yet."
    ),
    "consent_uuid": (
        "The consent this asset is covered by. Required when subject_role is "
        "'consented', and refused otherwise."
    ),
    "storage_ref": "Where the file actually lives - a path, a bucket key, an internal id.",
    "agent_ref": "Who captured it, if your process records that.",
    "site_uuid": "The collection site, where a manifest spans more than one.",
    "declared_asset_count": (
        "How many assets this collection session produced in total. The gap between "
        "this and the rows you supply is what the reconciliation report shows."
    ),
}


def manifest_template() -> bytes:
    """A CSV somebody can open, read and fill in.

    Three parts: the header row, one worked example, and the guidance that
    would otherwise be a documentation page nobody opens.

    A person handed an empty file with five column names guesses at the date
    format and at the vocabulary, and finds out they guessed wrong after
    uploading. A file that carries its own instructions gets read at the moment
    it is needed, by the person who needs it, in the tool they already have open.

    The guidance sits below the data and is prefixed `#`, which `parse_manifest`
    skips. So the template works whether or not somebody remembers to delete it
    - and forgetting is the common case, because the file is usually opened in
    Excel, edited in the middle, and saved.
    """
    buf = io.StringIO()
    writer = csv.writer(buf, lineterminator="\n")

    writer.writerow([*REQUIRED_COLUMNS, *OPTIONAL_COLUMNS])
    writer.writerow(
        [
            "RUN-2026-001",
            "IMG_0001.jpg",
            "image",
            # Timezone-aware, because a template generated near midnight in
            # one zone and read in another should not suggest tomorrow.
            datetime.now(UTC).date().isoformat(),
            "consented",
            "",  # consent_uuid - fill in for a consented subject
            "s3://collections/run-2026-001/IMG_0001.jpg",
            "",
            "",
            "",
        ]
    )

    buf.write("\n")
    buf.write("# Delete every line below before uploading.\n")
    buf.write("#\n")
    buf.write(f"# Required columns: {', '.join(REQUIRED_COLUMNS)}\n")
    buf.write(f"# Optional columns: {', '.join(OPTIONAL_COLUMNS)}\n")
    buf.write("#\n")
    for column in (*REQUIRED_COLUMNS, *OPTIONAL_COLUMNS):
        buf.write(f"# {column}: {COLUMN_HELP.get(column, '')}\n")
    buf.write("#\n")
    buf.write("# Validate before you import. The dry run reads the same file, applies the\n")
    buf.write("# same checks and writes nothing, so a bad manifest costs you a click\n")
    buf.write("# rather than a partial collection nobody can account for.\n")

    return buf.getvalue().encode("utf-8")


def parse_manifest(raw: bytes) -> tuple[list[dict[str, str]], list[dict[str, Any]]]:
    """Parse and shape-check. Returns (rows, errors). Writes nothing."""
    errors: list[dict[str, Any]] = []
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        return [], [{"row": 0, "field": "file", "error": "File is not valid UTF-8"}]

    # Comment and blank lines are dropped before the reader sees them, so the
    # guidance in the downloadable template survives a round trip through Excel
    # without becoming five rows of "required value is empty". A `#` is not CSV
    # syntax, but it is the convention every tool that emits these uses, and
    # supporting it costs one filter.
    body = "\n".join(
        line for line in text.splitlines() if line.strip() and not line.lstrip().startswith("#")
    )

    reader = csv.DictReader(io.StringIO(body))
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
