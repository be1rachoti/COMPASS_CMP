"""Turning a parsed notice document into a draft notice and its purposes.

`document.parse` reads the file; this decides what to write. The split matters
because the dry run and the real import share every line of both: `preview` runs
the same parse and the same planning as `commit` and then stops before the first
write, so what it reports is what will happen rather than a second implementation
that agrees with the first until it doesn't.

**Purposes are always created, never matched.** That is a deliberate choice: the
DPO decides whether two purposes are the same one, not a string comparison in an
importer. The cost is duplication, and it is paid for in two places - `preview`
reports existing purposes whose wording is close, so the DPO is shown the
candidates rather than left to find them, and a re-import cleans up the rows its
own previous run created, so correcting a typo does not grow the register.

**A published notice is never touched.** Its text is hashed into every consent
artefact served from it. Re-importing over a draft is editing something nobody
has agreed to yet; re-importing over a published notice would rewrite what people
already agreed to, so it is refused and a new version is the way forward.
"""

from __future__ import annotations

import difflib
import re
from typing import Any

from cmp.core.errors import Conflict, ValidationFailed
from cmp.db.repositories import notices as repo
from cmp.db.repositories import projects as project_repo
from cmp.db.repositories import registry as registry_repo
from cmp.db.sql import Conn
from cmp.domain.audit import service as audit
from cmp.domain.audit.service import Event
from cmp.domain.notices import service
from cmp.domain.notices.document import ParsedNotice, ParsedPurpose, parse

#: How alike two purposes must read before the dry run mentions one as a possible
#: duplicate. Deliberately loose - this is a prompt for a human, not a decision,
#: and a false suggestion costs a glance where a missed one costs a duplicate.
_SIMILAR = 0.82


async def _mint_code(conn: Conn, *, project_name: str, document_id: str) -> str:
    """A globally unique purpose code from a code that is unique to one document.

    "P-01" means "the first row of this table" and nothing else - two unrelated
    notices would both claim it, and `purpose.purpose_code` is UNIQUE. Prefixing
    with the project keeps the document's numbering visible in the register
    without borrowing its collision domain.
    """
    base = f"{service._slug(project_name, limit=16)}-{document_id.replace('-', '')}"
    if not await registry_repo.purpose_versions(conn, base):
        return base
    for suffix in range(2, 100):
        candidate = f"{base}-{suffix}"
        if not await registry_repo.purpose_versions(conn, candidate):
            return candidate
    raise ValidationFailed(
        f"Could not mint a unique code for purpose {document_id}", field="purpose_code"
    )


def _norm(text: str) -> str:
    return re.sub(r"\s+", " ", text or "").strip().lower()


def _looks_like(a: str, b: str, *, floor: float = 0.0) -> float:
    """How alike two purposes read, on difflib's 0..1 scale.

    `floor` turns this into "at least this alike, or don't care". That matters:
    the duplicate scan compares every imported purpose against every purpose in
    the register, and a full `ratio()` on paragraph-length text costs about 1.5ms
    - nine purposes against two thousand rows is 27 seconds, which reads as a
    hung dry run rather than a slow one.

    `real_quick_ratio` and `quick_ratio` are both cheap upper bounds on `ratio`,
    so a pair either of them puts below the floor cannot reach it and is dropped
    without the real comparison. Text of very different lengths - which is most
    pairs - never gets past the first check.
    """
    return _compare(_norm(a), _norm(b), floor=floor)


def _compare(left: str, right: str, *, floor: float = 0.0) -> float:
    """`_looks_like` for text that is already normalised.

    Split out because the duplicate scan compares nine purposes against the whole
    register: normalising inside that loop meant eighteen thousand regex passes
    over paragraph-length strings, which cost more than the comparison it was
    preparing for.
    """
    matcher = difflib.SequenceMatcher(None, left, right)
    if floor and (matcher.real_quick_ratio() < floor or matcher.quick_ratio() < floor):
        return 0.0
    return matcher.ratio()


async def _existing_draft(conn: Conn, project_id: int) -> dict[str, Any] | None:
    """The draft this import would replace, if there is one."""
    for notice in await repo.list_for_project(conn, project_id):
        if notice["status"] == "draft":
            return dict(notice)
    return None


async def _guard(
    conn: Conn, *, project_uuid: str, actor_id: int, role: str
) -> tuple[dict[str, Any], dict[str, Any] | None]:
    """The project, and the draft an import would land on.

    Raises rather than returning a verdict: every caller does the same thing with
    a refusal, and a boolean here would let one of them forget to check it.
    """
    project = await project_repo.require(
        conn, project_uuid, role=role, user_id=actor_id, write=True
    )

    # Asked of the notices themselves rather than of `project.current_notice_id`.
    # That column names the notice currently in force; a notice that was approved
    # but not yet in force, or one already superseded, is equally not something an
    # upload may rewrite, and reading the pointer would have missed both.
    cur = await conn.execute(
        """SELECT notice_code, status FROM notice
            WHERE project_id = %s AND status <> 'draft'
            ORDER BY notice_id LIMIT 1""",
        (project["project_id"],),
    )
    settled = await cur.fetchone()
    if settled:
        raise Conflict(
            f"This project already has the {settled['status']} notice "
            f"{settled['notice_code']}. Its text is hashed into every consent taken "
            "against it, so an upload cannot replace it - create a new version of the "
            "notice instead.",
            code="notice_published",
        )
    return dict(project), await _existing_draft(conn, project["project_id"])


async def preview(
    conn: Conn, *, project_uuid: str, actor_id: int, role: str, payload: bytes
) -> dict[str, Any]:
    """Read the document and report what importing it would do. Writes nothing."""
    parsed = parse(payload)
    project, draft = await _guard(conn, project_uuid=project_uuid, actor_id=actor_id, role=role)

    warnings = list(parsed.assumptions)
    if parsed.project_name and _looks_like(parsed.project_name, project["project_name"]) < 0.7:
        warnings.append(
            f"The document names the project '{parsed.project_name}', but this project "
            f"is '{project['project_name']}'. Check you are uploading to the right one."
        )
    if draft:
        warnings.append(
            f"This project already has the draft notice {draft['notice_code']}. "
            "Importing replaces its text and its purposes."
        )

    # The duplicate candidates. Reported, never acted on - see the module note.
    #
    # Queried directly rather than through `list_purposes`, which is cursor
    # paginated: this needs to compare against the whole register, and a
    # paginated read would quietly compare against the first page and report
    # "no duplicates" for a register that has one on page two.
    cur = await conn.execute(
        """SELECT purpose_code, name, uses FROM purpose
            WHERE status IN ('active', 'draft')
            ORDER BY purpose_id DESC LIMIT 2000"""
    )
    rows = await cur.fetchall()

    # Normalised once, not once per comparison.
    register = [(row, _norm(row["uses"] or "")) for row in rows]

    duplicates: list[dict[str, Any]] = []
    for p in parsed.purposes:
        mine = _norm(p.uses)
        for row, theirs in register:
            score = _compare(mine, theirs, floor=_SIMILAR)
            if score >= _SIMILAR:
                duplicates.append(
                    {
                        "document_id": p.document_id,
                        "name": p.name,
                        "resembles": row["purpose_code"],
                        "resembles_name": row["name"],
                        "similarity": round(score, 2),
                    }
                )
                break

    return {
        "ok": True,
        "project_name": project["project_name"],
        "language": parsed.language_code,
        "notice_code_in_document": parsed.notice_code,
        "replaces_draft": draft["notice_code"] if draft else None,
        "rendered_characters": len(parsed.rendered_text),
        "rendered_excerpt": parsed.rendered_text[:600],
        "data_categories": [{"id": k, "name": v} for k, v in sorted(parsed.categories.items())],
        "purposes": [
            {
                "document_id": p.document_id,
                "name": p.name,
                "uses": p.uses,
                "data_categories": p.data_categories,
                "retention_period": p.retention_period,
                "lawful_basis": p.lawful_basis,
                "is_mandatory": p.is_mandatory,
            }
            for p in parsed.purposes
        ],
        "possible_duplicates": duplicates,
        "warnings": warnings,
    }


async def commit(
    conn: Conn, *, project_uuid: str, actor_id: int, role: str, payload: bytes
) -> dict[str, Any]:
    """Create the notice, its purposes and its rendition from the document."""
    parsed = parse(payload)
    project, draft = await _guard(conn, project_uuid=project_uuid, actor_id=actor_id, role=role)

    if draft:
        notice = await _refresh_draft(conn, draft=draft, parsed=parsed, actor_id=actor_id)
        superseded = await _detach_all(conn, notice_id=notice["notice_id"])
    else:
        notice = await service.create(
            conn,
            project_uuid=project_uuid,
            actor_id=actor_id,
            role=role,
            notice_code=None,  # minted; the document's id is recorded in the note
            withdraw_url=parsed.withdraw_url,
            exercise_rights_url=parsed.exercise_rights_url,
            board_complaint_url=parsed.board_complaint_url,
            dpo_contact=parsed.dpo_contact,
            applicable_to=parsed.applicable_to or "data_subject",
            note=_note(parsed),
        )
        superseded = []

    await service.set_language(
        conn,
        notice_id=notice["notice_id"],
        language_code=parsed.language_code,
        rendered_text=parsed.rendered_text,
        actor_id=actor_id,
    )

    created: list[dict[str, Any]] = []
    for order, p in enumerate(parsed.purposes, start=1):
        purpose = await _create_purpose(
            conn, parsed=p, project_name=project["project_name"], actor_id=actor_id
        )
        await service.attach_purpose(
            conn,
            notice_id=notice["notice_id"],
            purpose_uuid=str(purpose["purpose_uuid"]),
            display_order=order,
            is_mandatory=p.is_mandatory,
            # The purposes arrive as drafts and are attached as drafts. Activating
            # a purpose is the DPO's act, and an R&D User who could do it by
            # uploading a file would be approving their own purposes. The notice
            # cannot publish while any of them is still draft - `checklist`
            # blocks on exactly that, the same way it blocks on a rendition
            # nobody has legally approved.
            allow_draft=True,
        )
        created.append(purpose)

    # Only now that the replacements are attached: a purpose the previous import
    # made, which this one did not re-attach and nothing else uses, is litter.
    discarded = await _discard_orphans(conn, purpose_ids=superseded)

    await audit.record(
        conn,
        event=Event.NOTICE_CREATED,
        entity_type="notice",
        entity_id=notice["notice_id"],
        detail={
            "source": "document_import",
            "project": project_uuid,
            "language": parsed.language_code,
            "purposes_created": [p["purpose_code"] for p in created],
            "purposes_discarded": discarded,
            "replaced_draft": bool(draft),
            "notice_id_in_document": parsed.notice_code,
        },
    )

    fresh = await repo.by_id(conn, notice["notice_id"])
    return dict(fresh or notice)


# ------------------------------------------------------------------- internals


def _note(parsed: ParsedNotice) -> str:
    """Where the notice came from, kept on the notice itself.

    The document's own Notice ID is not used as `notice_code` - that column is
    unique across the platform and versioned by us, and a document that gets
    filled in twice would collide. Recording it here keeps the two identifiable
    as the same thing without letting one govern the other.
    """
    bits = ["Imported from an uploaded notice document."]
    if parsed.notice_code:
        bits.append(f"Document Notice ID: {parsed.notice_code}.")
    return " ".join(bits)


async def _refresh_draft(
    conn: Conn, *, draft: dict[str, Any], parsed: ParsedNotice, actor_id: int
) -> dict[str, Any]:
    row = await repo.update_draft(
        conn,
        draft["notice_id"],
        withdraw_url=parsed.withdraw_url,
        exercise_rights_url=parsed.exercise_rights_url,
        board_complaint_url=parsed.board_complaint_url,
        dpo_contact=parsed.dpo_contact,
        applicable_to=parsed.applicable_to or "data_subject",
        note=_note(parsed),
        # Named in the statement, so it has to be supplied; NULL leaves whatever
        # classification the draft already carried.
        change_class=None,
    )
    return dict(row)


async def _detach_all(conn: Conn, *, notice_id: int) -> list[int]:
    """Unhook every purpose on the draft, returning what was there."""
    attached = await repo.purposes_of(conn, notice_id)
    ids = [row["purpose_id"] for row in attached]
    for row in attached:
        await repo.detach_purpose(conn, notice_id=notice_id, purpose_id=row["purpose_id"])
    return ids


async def _discard_orphans(conn: Conn, *, purpose_ids: list[int]) -> list[str]:
    """Delete purposes left behind by a superseded import.

    Guarded twice over, because deleting from the register is not a thing to get
    wrong: a purpose goes only if no notice still carries it *and* no consent was
    ever granted against it. Anything else stays, and a DPO can retire it by
    hand. A purpose that some other notice picked up in the meantime is somebody
    else's now.
    """
    gone: list[str] = []
    for purpose_id in purpose_ids:
        row = await registry_repo.purpose_by_id(conn, purpose_id)
        if not row:
            continue
        still_used = await registry_repo.purpose_usage(conn, purpose_id)
        if still_used:
            continue
        granted = await _has_grants(conn, purpose_id)
        if granted:
            continue
        await conn.execute("DELETE FROM purpose WHERE purpose_id = %s", (purpose_id,))
        gone.append(row["purpose_code"])
    return gone


async def _has_grants(conn: Conn, purpose_id: int) -> bool:
    cur = await conn.execute(
        "SELECT 1 FROM consent_purpose_grant WHERE purpose_id = %s LIMIT 1", (purpose_id,)
    )
    return await cur.fetchone() is not None


async def _create_purpose(
    conn: Conn, *, parsed: ParsedPurpose, project_name: str, actor_id: int
) -> dict[str, Any]:
    code = await _mint_code(conn, project_name=project_name, document_id=parsed.document_id)
    row = await registry_repo.create_purpose(
        conn,
        created_by=actor_id,
        purpose_code=code,
        name=parsed.name,
        description=parsed.description,
        uses=parsed.uses,
        lawful_basis=parsed.lawful_basis,
        s7_clause=parsed.s7_clause,
        data_categories=parsed.data_categories,
        retention_period=parsed.retention_period,
        retention_basis=parsed.retention_basis,
        erasure_trigger=parsed.erasure_trigger,
        consent_validity_period=None,
        # The document says nothing about these, so they take the setting that
        # permits least. Surfaced as an assumption by the dry run rather than
        # applied silently - see `document.parse`.
        cross_border_permitted=False,
        permitted_for_minors=False,
        lapse_behaviour="quarantine",
    )
    await audit.record(
        conn,
        event=Event.PURPOSE_CREATED,
        entity_type="purpose",
        entity_id=row["purpose_id"],
        detail={"source": "document_import", "code": code, "document_id": parsed.document_id},
    )
    return dict(row)
