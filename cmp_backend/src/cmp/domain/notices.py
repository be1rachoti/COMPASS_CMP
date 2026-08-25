"""Notice authoring and publication.

Publication is the moment the platform makes a promise it must keep. In one
transaction it validates every Rule 3 element, generates `recipients_text` from
the project's sites, computes a sha256 per language rendition, and marks the
notice published. After that the text is immutable - the database refuses an edit
(migration 0002) and this module offers no path to one.

`content_hash` is what makes INV-4 work. Each consent artefact copies the hash of
the exact rendition served, so "show me what she agreed to" is answerable from
the artefact alone, and a later correction cannot silently repoint her record at
words she never saw.
"""

from __future__ import annotations

import re
from datetime import UTC, datetime
from typing import Any

from cmp.core.errors import Conflict, NotFound, NoticeImmutable, NoticeIncomplete, ValidationFailed
from cmp.core.logging import get_logger
from cmp.core.security import content_hash
from cmp.db.repositories import notices as repo
from cmp.db.repositories import projects as project_repo
from cmp.db.repositories import registry as registry_repo
from cmp.db.sql import Conn
from cmp.domain import audit
from cmp.domain.audit import Event

log = get_logger("cmp.notices")

DRAFT_STATES = ("draft", "approved")


def _slug(text: str, *, limit: int = 20) -> str:
    """A short, stable, upper-case token from a project name.

    Only the characters `notice_code` accepts survive; runs of anything else
    collapse to a single dash.

    Truncation happens on word boundaries, not mid-word. "Fix Verification Study"
    becoming FIX-VERIFICATION reads as an abbreviation somebody chose;
    FIX-VERIFICATION-S reads as a bug, and the code is going to appear on
    printed consent records.
    """
    words = [w for w in re.split(r"[^A-Za-z0-9]+", text.upper()) if w]
    if not words:
        return "NOTICE"

    # The first word is taken whatever its length, then cut to the limit: a
    # project named after one very long word still has to produce a code, and a
    # cut there is better than an empty slug.
    out = [words[0][:limit]]
    used = len(out[0])

    for word in words[1:]:
        cost = len(word) + 1  # the joining dash
        if used + cost > limit:
            break
        out.append(word)
        used += cost

    return "-".join(out)


async def generate_code(conn: Conn, *, project_name: str) -> str:
    """Mint a notice code nobody has to think about.

    A notice code is an internal identifier that has to be stable across versions
    and unique across the platform. Asking a DPO to invent one is asking them to
    do a uniqueness check in their head; they cannot see the other projects'
    codes, so the only feedback they get is a constraint violation on submit.

    The shape is NTC-<project>-<year>, with a numeric suffix only where that is
    already taken. The suffix is a collision breaker, not a version: versions live
    in `notice.version` and share the code.
    """
    base = f"NTC-{_slug(project_name)}-{datetime.now(UTC).year}"

    if await repo.max_version(conn, base) == 0:
        return base

    # Bounded rather than a while-true. Twenty-six notices for one project in one
    # year is already well past the point where the name is the real problem.
    for suffix in range(2, 27):
        candidate = f"{base}-{suffix}"
        if await repo.max_version(conn, candidate) == 0:
            return candidate

    raise ValidationFailed(
        "Could not generate a unique notice code for this project. "
        "Give one explicitly.",
        field="notice_code",
    )


async def create(
    conn: Conn,
    *,
    project_uuid: str,
    actor_id: int,
    role: str,
    withdraw_url: str,
    exercise_rights_url: str,
    board_complaint_url: str,
    dpo_contact: str,
    notice_code: str | None = None,
    change_class: str | None = None,
    language_code: str | None = None,
    rendered_text: str | None = None,
) -> dict[str, Any]:
    """Create a draft notice, optionally with its first rendition already in it.

    `notice_code` is generated when omitted - see `generate_code`.

    `rendered_text` is the notice a data subject actually reads. Accepting it here
    means one screen instead of two: a DPO who has the text in front of them can
    put it in without first saving an empty shell and then hunting for the
    language editor.
    """
    project = await project_repo.require(conn, project_uuid, role=role, user_id=actor_id)

    code = notice_code or await generate_code(conn, project_name=project["project_name"])
    version = await repo.max_version(conn, code) + 1

    notice = await repo.create(
        conn,
        project_id=project["project_id"],
        notice_code=code,
        version=version,
        withdraw_url=withdraw_url,
        exercise_rights_url=exercise_rights_url,
        board_complaint_url=board_complaint_url,
        dpo_contact=dpo_contact,
        change_class=change_class,
    )
    await audit.record(
        conn,
        event=Event.NOTICE_CREATED,
        entity_type="notice",
        entity_id=notice["notice_id"],
        detail={
            "project": project_uuid,
            "notice_code": code,
            "version": version,
            "code_generated": notice_code is None,
        },
    )

    if rendered_text and rendered_text.strip():
        await set_language(
            conn,
            notice_id=notice["notice_id"],
            language_code=language_code or "english",
            rendered_text=rendered_text,
            actor_id=actor_id,
        )
        notice = await repo.by_id(conn, notice["notice_id"]) or notice

    return notice


async def copy_from(
    conn: Conn,
    *,
    project_uuid: str,
    source_notice_uuid: str,
    actor_id: int,
    role: str,
) -> dict[str, Any]:
    """Start a project's notice from one that already exists.

    A copy, never a shared row. `notice.project_id` is single-valued and the
    consent artefact records which notice was served, so two projects pointing at
    one notice would make "which text did she agree to, for which project"
    unanswerable. Copying keeps every artefact pointing at exactly one notice.

    Purposes and language renditions come across. Approvals do not: a lawyer
    approved that text for that project's recipients, and carrying the approval
    over would launder a sign-off nobody gave.
    """
    project = await project_repo.require(conn, project_uuid, role=role, user_id=actor_id)
    source = await repo.by_uuid(conn, source_notice_uuid, role=role, user_id=actor_id)
    if not source:
        raise NotFound("Notice")

    code = await generate_code(conn, project_name=project["project_name"])
    notice = await repo.create(
        conn,
        project_id=project["project_id"],
        notice_code=code,
        version=1,
        withdraw_url=source["withdraw_url"],
        exercise_rights_url=source["exercise_rights_url"],
        board_complaint_url=source["board_complaint_url"],
        dpo_contact=source["dpo_contact"],
        change_class=None,
    )

    purposes = await repo.purposes_of(conn, source["notice_id"])
    for purpose in purposes:
        await repo.attach_purpose(
            conn,
            notice_id=notice["notice_id"],
            purpose_id=purpose["purpose_id"],
            display_order=purpose.get("display_order") or 0,
            is_mandatory=bool(purpose.get("is_mandatory")),
        )

    languages = await repo.languages_of(conn, source["notice_id"], with_text=True)
    for language in languages:
        await set_language(
            conn,
            notice_id=notice["notice_id"],
            language_code=language["language_code"],
            rendered_text=language["rendered_text"],
            actor_id=actor_id,
        )

    await audit.record(
        conn,
        event=Event.NOTICE_CREATED,
        entity_type="notice",
        entity_id=notice["notice_id"],
        detail={
            "project": project_uuid,
            "notice_code": code,
            "copied_from": source_notice_uuid,
            "purposes": len(purposes),
            "languages": len(languages),
        },
    )
    return await repo.by_id(conn, notice["notice_id"]) or notice


async def _require_draft(conn: Conn, notice_id: int) -> dict[str, Any]:
    locked = await repo.lock(conn, notice_id)
    if locked["status"] not in DRAFT_STATES:
        raise NoticeImmutable(
            "A published notice cannot be edited. Create a new version.",
            details={"status": locked["status"]},
        )
    return locked


async def update(conn: Conn, *, notice_id: int, **fields: Any) -> dict[str, Any]:
    await _require_draft(conn, notice_id)
    updated = await repo.update_draft(conn, notice_id, **fields)
    await audit.record(
        conn,
        event=Event.NOTICE_UPDATED,
        entity_type="notice",
        entity_id=notice_id,
        detail={"fields": sorted(k for k, v in fields.items() if v is not None)},
    )
    return updated


async def attach_purpose(
    conn: Conn,
    *,
    notice_id: int,
    purpose_uuid: str,
    display_order: int = 0,
    is_mandatory: bool = False,
) -> dict[str, Any]:
    await _require_draft(conn, notice_id)

    purpose = await registry_repo.purpose_by_uuid(conn, purpose_uuid)
    if not purpose:
        raise NotFound("Purpose")
    if purpose["status"] != "active":
        raise ValidationFailed(
            "Only an active purpose may be attached to a notice",
            field="purpose_uuid",
            details={"status": purpose["status"]},
        )

    row = await repo.attach_purpose(
        conn,
        notice_id=notice_id,
        purpose_id=purpose["purpose_id"],
        display_order=display_order,
        is_mandatory=is_mandatory,
    )
    await audit.record(
        conn,
        event=Event.NOTICE_PURPOSE_ATTACHED,
        entity_type="notice_purpose",
        entity_id=row["notice_purpose_id"],
        detail={"notice_id": notice_id, "purpose": purpose_uuid,
                "is_mandatory": is_mandatory},
    )
    return row


async def detach_purpose(conn: Conn, *, notice_id: int, purpose_uuid: str) -> None:
    await _require_draft(conn, notice_id)
    purpose = await registry_repo.purpose_by_uuid(conn, purpose_uuid)
    if not purpose:
        raise NotFound("Purpose")

    removed = await repo.detach_purpose(
        conn, notice_id=notice_id, purpose_id=purpose["purpose_id"]
    )
    if not removed:
        raise NotFound("Purpose on this notice")
    await audit.record(
        conn,
        event=Event.NOTICE_PURPOSE_DETACHED,
        entity_type="notice_purpose",
        entity_id=purpose["purpose_id"],
        detail={"notice_id": notice_id, "purpose": purpose_uuid},
    )


async def set_language(
    conn: Conn, *, notice_id: int, language_code: str, rendered_text: str, actor_id: int
) -> dict[str, Any]:
    """Store a rendition and its hash.

    Re-uploading a rendition clears its approval: text that changed after a
    lawyer signed it off has not been signed off.
    """
    await _require_draft(conn, notice_id)
    digest = content_hash(rendered_text)

    row = await repo.upsert_language(
        conn,
        notice_id=notice_id,
        language_code=language_code,
        rendered_text=rendered_text,
        content_hash=digest,
        created_by=actor_id,
    )
    await audit.record(
        conn,
        event=Event.NOTICE_LANGUAGE_ADDED,
        entity_type="notice_language",
        entity_id=row["notice_language_id"],
        detail={"notice_id": notice_id, "language": language_code, "sha256": digest},
    )
    return row


async def approve_language(
    conn: Conn, *, notice_id: int, language_code: str, actor_id: int
) -> dict[str, Any]:
    """Approval is per language, not once per notice.

    A DPO who reads English and approves eight renditions has approved one.
    """
    row = await repo.approve_language(
        conn, notice_id=notice_id, language_code=language_code, approved_by=actor_id
    )
    if not row:
        raise NotFound("Language rendition")

    await audit.record(
        conn,
        event=Event.NOTICE_LANGUAGE_APPROVED,
        entity_type="notice_language",
        entity_id=notice_id,
        detail={"language": language_code, "sha256": row["content_hash"]},
    )
    return row


async def checklist(conn: Conn, notice_id: int) -> dict[str, Any]:
    """Exactly what is blocking publication.

    The UI shows a list, not a failed submit. Every item names the field so the
    frontend can link straight to it.
    """
    notice = await repo.by_id(conn, notice_id)
    if not notice:
        raise NotFound("Notice")

    purposes = await repo.purposes_of(conn, notice_id)
    languages = await repo.languages_of(conn, notice_id)
    sites = await project_repo.list_sites(conn, notice["project_id"])

    blocking: list[str] = []

    for field, label in (
        ("withdraw_url", "withdraw_url is empty"),
        ("exercise_rights_url", "exercise_rights_url is empty"),
        ("board_complaint_url", "board_complaint_url is empty"),
        ("dpo_contact", "dpo_contact is empty"),
    ):
        if not (notice.get(field) or "").strip():
            blocking.append(label)

    if not purposes:
        blocking.append("no purposes attached")
    if not languages:
        blocking.append("no language rendition has been added")

    for lang in languages:
        if lang["approved_at"] is None:
            blocking.append(f"language '{lang['language_code']}' is not legally approved")

    if notice["status"] in ("published", "superseded"):
        blocking.append(f"this notice is already {notice['status']}")

    # A site is deliberately NOT blocking. Sites are the R&D User's to add - they
    # know where collection will actually happen - and a notice can be lawful and
    # complete before any site exists. Requiring one here made the DPO invent a
    # placeholder site to get past their own screen, which is worse than an empty
    # recipients line: it puts a fiction in the notice a data subject reads.
    # The count is still reported so the DPO can see the gap and chase it.

    return {
        "publishable": not blocking,
        "blocking": blocking,
        "purpose_count": len(purposes),
        "language_count": len(languages),
        "approved_language_count": sum(1 for x in languages if x["approved_at"]),
        "site_count": len(sites),
    }


async def publish(conn: Conn, *, notice_id: int, actor_id: int) -> dict[str, Any]:
    """One transaction: validate -> generate recipients -> freeze hashes -> publish."""
    locked = await repo.lock(conn, notice_id)
    if locked["status"] in ("published", "superseded"):
        raise NoticeImmutable("This notice is already published")

    state = await checklist(conn, notice_id)
    if not state["publishable"]:
        raise NoticeIncomplete(
            state["blocking"][0],
            details={"blocking": state["blocking"]},
        )

    recipients = await repo.recipients_text(conn, locked["project_id"])

    # Recompute every hash from the stored text at the moment of publication.
    # Trusting a hash computed at upload time would freeze a digest of text that
    # may have been replaced since.
    languages = await repo.languages_of(conn, notice_id, with_text=True)
    for lang in languages:
        recomputed = content_hash(lang["rendered_text"])
        if recomputed != lang["content_hash"]:
            raise Conflict(
                f"Stored hash for '{lang['language_code']}' does not match its text",
                code="notice_hash_mismatch",
            )

    # Any previously published version of this code is superseded by this one.
    for prior in await repo.versions(conn, locked["notice_code"]):
        if prior["notice_id"] != notice_id and prior["status"] == "published":
            await repo.supersede(conn, prior["notice_id"])
            await audit.record(
                conn,
                event=Event.NOTICE_SUPERSEDED,
                entity_type="notice",
                entity_id=prior["notice_id"],
                detail={"superseded_by": notice_id},
            )

    published = await repo.publish(
        conn, notice_id, recipients_text=recipients, approved_by=actor_id
    )
    await project_repo.set_current_notice(conn, locked["project_id"], notice_id)

    await audit.record(
        conn,
        event=Event.NOTICE_PUBLISHED,
        entity_type="notice",
        entity_id=notice_id,
        detail={
            "notice_code": locked["notice_code"],
            "version": locked["version"],
            "languages": {x["language_code"]: x["content_hash"] for x in languages},
            "recipients_text": recipients,
        },
    )
    log.info(
        "notice.published",
        notice_id=notice_id,
        version=locked["version"],
        languages=len(languages),
    )
    return published


async def publish_current(
    conn: Conn, *, project_id: int, actor_id: int
) -> dict[str, Any] | None:
    """Publish the project's draft notice as part of in_draft -> under_process.

    Called by the transition, so publication and the status change share one
    transaction: a project cannot end up under process with an unpublished notice.

    The postcondition is *the project has a published notice*, not *this call
    published one*. A DPO who published the notice from the notice screen before
    moving the project has already satisfied it, and refusing the transition then
    would be the system insisting on its own preferred order of operations.
    """
    notices = await repo.list_for_project(conn, project_id)
    drafts = [n for n in notices if n["status"] in DRAFT_STATES]

    if not drafts:
        already = [n for n in notices if n["status"] == "published"]
        if already:
            return max(already, key=lambda n: n["version"])
        raise NoticeIncomplete("The project has no notice to publish")

    newest = max(drafts, key=lambda n: n["version"])
    return await publish(conn, notice_id=newest["notice_id"], actor_id=actor_id)


async def preview(conn: Conn, notice_id: int, language_code: str | None = None) -> dict[str, Any]:
    """Render what a data subject would see, without publishing anything."""
    notice = await repo.by_id(conn, notice_id)
    if not notice:
        raise NotFound("Notice")

    purposes = await repo.purposes_of(conn, notice_id)
    languages = await repo.languages_of(conn, notice_id, with_text=True)
    chosen = None
    if language_code:
        chosen = next((x for x in languages if x["language_code"] == language_code), None)
    elif languages:
        chosen = languages[0]

    return {
        "notice": {k: notice[k] for k in
                   ("notice_uuid", "notice_code", "version", "status", "withdraw_url",
                    "exercise_rights_url", "board_complaint_url", "dpo_contact",
                    "recipients_text")},
        "project_name": notice["project_name"],
        "purposes": [{k: v for k, v in x.items() if k != "purpose_id"} for x in purposes],
        "available_languages": [x["language_code"] for x in languages],
        "language_code": chosen["language_code"] if chosen else None,
        "rendered_text": chosen["rendered_text"] if chosen else None,
        "content_hash": chosen["content_hash"] if chosen else None,
        "recipients_preview": await repo.recipients_text(conn, notice["project_id"]),
    }
