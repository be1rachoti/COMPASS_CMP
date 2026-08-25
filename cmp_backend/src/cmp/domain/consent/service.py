"""The consent flow - capture, withdrawal, and the link that carries them.

The rules that make an artefact evidence rather than a row:

* **The subject comes from the session, never from the request body.** There is
  no code path by which any role records consent for someone else.
* **`served_at <= affirmative_action_at`.** s.5(1): the notice must be given
  before or with the request for consent. A record where she acted before the
  text rendered is defective on its face, and the database refuses it.
* **The content hash is copied at capture.** Not referenced - copied. INV-4.
* **Withdrawal supersedes, never edits.** The old artefact stays exactly as it
  was; a new one points back at it. The chain is the record.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

from cmp.auth.authentication import otp
from cmp.auth.rate_limit import service as ratelimit
from cmp.core.config import settings
from cmp.core.errors import (
    Conflict,
    ConsentDefective,
    LinkInvalid,
    NotFound,
    ValidationFailed,
)
from cmp.core.logging import get_logger
from cmp.core.security import new_token, token_fingerprint
from cmp.db.repositories import consent as repo
from cmp.db.repositories import notices as notice_repo
from cmp.db.repositories import projects as project_repo
from cmp.db.repositories import users as user_repo
from cmp.db.sql import Conn
from cmp.domain.audit import service as audit
from cmp.domain.audit.service import Event

log = get_logger("cmp.consent")


# --------------------------------------------------------------------- links
async def create_link(
    conn: Conn,
    *,
    site_uuid: str,
    expires_at: datetime,
    max_uses: int | None,
    actor_id: int,
    role: str,
) -> dict[str, Any]:
    """Mint a site's consent link.

    `expires_at` is required and has no default and no maximum. The absence of a
    pre-fill is the control: someone has to decide how long this link should
    live, and a default would be chosen once and never revisited.
    """
    site = await project_repo.site_by_uuid(conn, site_uuid, role=role, user_id=actor_id)
    if not site:
        raise NotFound("Site")
    if site["status"] != "active":
        raise Conflict("That site is not active", code="site_inactive")
    if site["project_status"] != "approved":
        raise Conflict(
            "A consent link may only exist for a project in approved",
            code="project_not_approved",
            details={"status": site["project_status"]},
        )
    if expires_at <= datetime.now(UTC):
        raise ValidationFailed("expires_at must be in the future", field="expires_at")

    project = await project_repo.require(
        conn, str(site["project_uuid"]), role=role, user_id=actor_id
    )
    notices = await notice_repo.list_for_project(conn, project["project_id"])
    published = [n for n in notices if n["status"] == "published"]
    if not published:
        raise Conflict(
            "The project has no published notice to serve", code="no_published_notice"
        )
    notice = max(published, key=lambda n: n["version"])

    # The raw token is returned once and never stored. What goes in the database
    # is its keyed digest, so a table dump does not yield working links.
    raw = new_token(32)
    link = await repo.create_link(
        conn,
        notice_id=notice["notice_id"],
        site_id=site["site_id"],
        token_stored=token_fingerprint(raw)[:64],
        expires_at=expires_at,
        max_uses=max_uses,
        created_by=actor_id,
    )
    await audit.record(
        conn,
        event=Event.LINK_CREATED,
        entity_type="consent_link",
        entity_id=link["link_id"],
        detail={"site": site_uuid, "notice": str(notice["notice_uuid"]),
                "expires_at": expires_at.isoformat(), "max_uses": max_uses},
    )
    return {**link, "token": raw, "site_uuid": site_uuid,
            "notice_uuid": notice["notice_uuid"]}


async def resolve_link(conn: Conn, token: str) -> dict[str, Any]:
    """Validate a link token.

    Every failure returns the same error. Distinguishing expired from revoked
    from unknown tells a token-guesser which of their guesses was structurally
    valid.
    """
    link = await repo.link_by_token(conn, token_fingerprint(token)[:64])
    if not link:
        raise LinkInvalid()

    now = datetime.now(UTC)
    if (
        link["status"] != "active"
        or link["expires_at"] <= now
        or (link["max_uses"] is not None and link["use_count"] >= link["max_uses"])
        or link["notice_status"] not in ("published", "superseded")
        or link["project_status"] != "approved"
        or link["site_status"] != "active"
    ):
        raise LinkInvalid()

    return link


async def register_subject(
    conn: Conn,
    *,
    token: str,
    full_name: str,
    email: str,
    mobile: str | None,
    organization_id: str | None,
    person_type: str | None,
) -> dict[str, Any]:
    """Create or recognise the person behind a link.

    `registered_via_link_id` is the audit trail for an open link. If a link
    circulates beyond its intended population this identifies everyone who came
    through it - including anyone who registered and abandoned before consenting,
    who otherwise leaves no artefact to trace.
    """
    link = await resolve_link(conn, token)

    existing = await user_repo.by_email(conn, email)
    if existing:
        if existing["role"] != "data_subject":
            # A staff account arriving through a consent link is either a mistake
            # or an attempt to bind staff identity to a subject record.
            raise Conflict(
                "That email belongs to a staff account. Sign in instead.",
                code="staff_account",
            )
        user = existing
        created = False
    else:
        consumed = await repo.increment_use(conn, link["link_id"])
        if not consumed:
            raise LinkInvalid()
        user = await user_repo.create(
            conn,
            full_name=full_name,
            email=email,
            mobile=mobile,
            organization_id=organization_id,
            role="data_subject",
            person_type=person_type,
            status="pending",
            registered_via_link_id=link["link_id"],
        )
        created = True

    await audit.record(
        conn,
        event=Event.SUBJECT_REGISTERED,
        entity_type="auth_user",
        entity_id=user["id"],
        subject_user_id=user["id"],
        actor_user_id=user["id"],
        detail={"link": str(link["link_uuid"]), "new_account": created},
    )
    return {"user": user, "link": link, "created": created}


async def send_contact_code(conn: Conn, *, token: str, contact: str) -> None:
    link = await resolve_link(conn, token)

    await ratelimit.enforce(
        "consent_otp_contact", contact.lower(),
        limit=settings.otp_requests_per_contact_per_hour, window_s=3600,
        message="Too many code requests for this contact.",
    )
    await ratelimit.enforce(
        "consent_otp_token", str(link["link_uuid"]),
        limit=settings.otp_requests_per_token_per_hour, window_s=3600,
        message="Too many code requests for this link.",
    )

    issued = await otp.issue(otp.Scope.CONSENT_LINK, f"{link['link_uuid']}:{contact.lower()}")
    from cmp.tasks.authentication import send_consent_code
    from cmp.tasks.dispatch import dispatch_required

    dispatch_required(send_consent_code, contact, issued.code)


async def verify_contact_code(conn: Conn, *, token: str, contact: str, code: str) -> dict[str, Any]:
    """Verify the code and establish the subject session.

    This is what makes `POST /c/{token}/consent` safe: the subject is taken from
    the session established here, never from the request body.
    """
    link = await resolve_link(conn, token)
    await otp.require(otp.Scope.CONSENT_LINK, f"{link['link_uuid']}:{contact.lower()}", code)

    user = await user_repo.by_contact(conn, contact)
    if not user:
        raise NotFound("Registration")

    if user["status"] == "pending":
        await user_repo.set_status(conn, user["id"], "active")

    await audit.record(
        conn,
        event=Event.OTP_VERIFIED,
        entity_type="auth_user",
        entity_id=user["id"],
        subject_user_id=user["id"],
        actor_user_id=user["id"],
        detail={"flow": "consent_link", "link": str(link["link_uuid"])},
    )
    return {"user": user, "link": link}


async def serve_notice(
    conn: Conn, *, token: str, language_code: str, user_id: int | None
) -> dict[str, Any]:
    """Render the notice and stamp `served_at`.

    The timestamp returned here is what the subsequent consent call must carry.
    It is not taken from the client: a client-supplied `served_at` could claim
    the notice was shown at any convenient moment.
    """
    link = await resolve_link(conn, token)
    language = await notice_repo.language_row(
        conn, notice_id=link["notice_id"], language_code=language_code
    )
    if not language:
        raise NotFound("Language rendition")
    if language["approved_at"] is None:
        raise Conflict(
            "That language rendition is not legally approved", code="language_unapproved"
        )

    purposes = await notice_repo.purposes_of(conn, link["notice_id"])
    served_at = datetime.now(UTC)

    if user_id:
        await audit.record(
            conn,
            event=Event.NOTICE_SERVED,
            entity_type="notice",
            entity_id=link["notice_id"],
            subject_user_id=user_id,
            actor_user_id=user_id,
            detail={"language": language_code, "sha256": language["content_hash"],
                    "link": str(link["link_uuid"])},
        )

    return {
        "notice": {
            "uuid": link["notice_uuid"],
            "code": link["notice_code"],
            "version": link["version"],
            "withdraw_url": link["withdraw_url"],
            "exercise_rights_url": link["exercise_rights_url"],
            "board_complaint_url": link["board_complaint_url"],
            "dpo_contact": link["dpo_contact"],
            "recipients_text": link["recipients_text"],
        },
        "project_name": link["project_name"],
        "site_label": link["site_label"],
        "language_code": language_code,
        "rendered_text": language["rendered_text"],
        "content_hash": language["content_hash"],
        # Strip the integer id before this leaves the process: the public flow
        # has no response model to filter it for us.
        "purposes": [
            {k: v for k, v in p.items() if k != "purpose_id"} for p in purposes
        ],
        "served_at": served_at,
    }


async def capture(
    conn: Conn,
    *,
    token: str,
    user_id: int,
    language_code: str,
    served_at: datetime,
    grants: dict[str, bool],
    action_type: str,
    ip_address: str | None,
) -> dict[str, Any]:
    """Write the artefact and its grants.

    One transaction. A grant row without its artefact, or an artefact without its
    grants, is not a partial record - it is an unanswerable question about what
    somebody agreed to.
    """
    link = await resolve_link(conn, token)
    language = await notice_repo.language_row(
        conn, notice_id=link["notice_id"], language_code=language_code
    )
    if not language:
        raise NotFound("Language rendition")

    now = datetime.now(UTC)
    if served_at > now:
        raise ConsentDefective("The notice cannot have been served in the future")
    if served_at > now + timedelta(seconds=1):
        raise ConsentDefective("served_at is after the affirmative action (s.5(1))")
    if (now - served_at) > timedelta(hours=6):
        # A stale render means the text may have changed under her.
        raise ConsentDefective(
            "This page has been open too long. Reload the notice and try again.",
            code="notice_stale",
        )

    purposes = await notice_repo.purposes_of(conn, link["notice_id"])
    by_uuid = {str(p["purpose_uuid"]): p for p in purposes}

    unknown = sorted(set(grants) - set(by_uuid))
    if unknown:
        raise ValidationFailed(
            "A purpose in the request is not part of this notice",
            field="grants",
            details={"unknown": unknown},
        )

    missing = sorted(set(by_uuid) - set(grants))
    if missing:
        # Silence is not consent. Every purpose must carry an explicit answer.
        raise ValidationFailed(
            "Every purpose on the notice must be answered",
            field="grants",
            details={"unanswered": missing},
        )

    for uuid_, purpose in by_uuid.items():
        if purpose["is_mandatory"] and not grants[uuid_]:
            raise ValidationFailed(
                f"'{purpose['name']}' cannot be refused on this notice",
                field="grants",
            )

    existing = await repo.current_for_user_notice(
        conn, user_id=user_id, notice_id=link["notice_id"]
    )

    artefact = await repo.create_artefact(
        conn,
        auth_user_id=user_id,
        notice_id=link["notice_id"],
        notice_language_id=language["notice_language_id"],
        notice_content_hash=language["content_hash"],  # copied, not referenced
        link_id=link["link_id"],
        served_at=served_at,
        affirmative_action_at=now,
        action_type=action_type,
        ip_address=ip_address,
        is_withdrawal=False,
        supersedes_consent_id=existing["consent_id"] if existing else None,
    )
    await repo.add_grants(
        conn,
        artefact["consent_id"],
        {by_uuid[u]["purpose_id"]: v for u, v in grants.items()},
    )

    any_granted = any(grants.values())
    await audit.record(
        conn,
        event=Event.CONSENT_GIVEN if any_granted else Event.CONSENT_DECLINED,
        entity_type="consent_artefact",
        entity_id=artefact["consent_id"],
        subject_user_id=user_id,
        actor_user_id=user_id,
        detail={
            "notice": str(link["notice_uuid"]),
            "language": language_code,
            "sha256": language["content_hash"],
            "granted": sorted(u for u, v in grants.items() if v),
            "refused": sorted(u for u, v in grants.items() if not v),
            "supersedes": existing["consent_uuid"] if existing else None,
        },
    )

    user = await user_repo.by_id(conn, user_id)
    if user and any_granted:
        # Optional: the artefact is written. A receipt that could not be queued
        # must not tell her the consent failed.
        from cmp.tasks.dispatch import dispatch_optional
        from cmp.tasks.notifications import send_consent_receipt

        dispatch_optional(
            send_consent_receipt,
            user["email"], str(artefact["consent_uuid"]), link["project_name"],
        )

    log.info("consent.captured", consent=str(artefact["consent_uuid"]),
             granted=sum(1 for v in grants.values() if v), total=len(grants))
    return {**artefact, "project_name": link["project_name"],
            "notice_uuid": link["notice_uuid"]}


async def withdraw(
    conn: Conn,
    *,
    consent_uuid: str,
    user_id: int,
    purpose_uuids: list[str] | None,
    withdraw_all: bool,
    ip_address: str | None,
) -> dict[str, Any]:
    """Withdraw some or all purposes.

    A new artefact supersedes the old one, carrying the same notice and the same
    copied hash - because what she is withdrawing from is the text she saw, not
    whatever the notice says now.

    The response states what stops, what continues, and that data already
    collected is not reached by this release.
    """
    current = await repo.artefact_by_uuid(conn, consent_uuid)
    if not current or current["auth_user_id"] != user_id:
        # Scope in the query result, not a separate permission check.
        raise NotFound("Consent record")

    live = await repo.current_for_user_notice(
        conn, user_id=user_id, notice_id=current["notice_id"]
    )
    if not live or live["consent_id"] != current["consent_id"]:
        raise Conflict(
            "This consent record has been superseded. Withdraw the current one.",
            code="consent_superseded",
        )

    grants = await repo.grants_of(conn, current["consent_id"])
    by_uuid = {str(g["purpose_uuid"]): g for g in grants}

    if withdraw_all:
        targets = set(by_uuid)
    else:
        targets = set(purpose_uuids or [])
        unknown = sorted(targets - set(by_uuid))
        if unknown:
            raise ValidationFailed(
                "A purpose in the request is not part of this consent",
                field="purposes",
                details={"unknown": unknown},
            )
    if not targets:
        raise ValidationFailed("Name at least one purpose, or set all", field="purposes")

    new_grants: dict[str, bool] = {}
    for uuid_, grant in by_uuid.items():
        new_grants[uuid_] = False if uuid_ in targets else bool(grant["granted"])

    now = datetime.now(UTC)
    artefact = await repo.create_artefact(
        conn,
        auth_user_id=user_id,
        notice_id=current["notice_id"],
        notice_language_id=current["notice_language_id"],
        notice_content_hash=current["notice_content_hash"],
        link_id=current["link_id"],
        served_at=now,
        affirmative_action_at=now,
        action_type="button_press",
        ip_address=ip_address,
        is_withdrawal=True,
        supersedes_consent_id=current["consent_id"],
    )

    from cmp.db.repositories import registry as registry_repo

    purpose_ids: dict[int, bool] = {}
    for uuid_, granted in new_grants.items():
        purpose = await registry_repo.purpose_by_uuid(conn, uuid_)
        if purpose:
            purpose_ids[purpose["purpose_id"]] = granted
    await repo.add_grants(conn, artefact["consent_id"], purpose_ids)

    stopped = [by_uuid[u]["name"] for u in targets]
    continuing = [g["name"] for u, g in by_uuid.items() if new_grants[u]]

    # A purpose on a s.7 basis does not stop because consent was withdrawn -
    # consent was never what authorised it. Saying otherwise is a promise the
    # platform cannot keep.
    other_basis = [
        by_uuid[u]["name"] for u in targets
        if by_uuid[u]["lawful_basis"] == "legitimate_use_s7"
    ]

    await audit.record(
        conn,
        event=Event.CONSENT_WITHDRAWN,
        entity_type="consent_artefact",
        entity_id=artefact["consent_id"],
        subject_user_id=user_id,
        actor_user_id=user_id,
        detail={"supersedes": consent_uuid, "withdrawn": sorted(targets),
                "all": withdraw_all},
    )

    user = await user_repo.by_id(conn, user_id)
    if user:
        from cmp.tasks.dispatch import dispatch_optional
        from cmp.tasks.notifications import send_withdrawal_confirmation

        dispatch_optional(
            send_withdrawal_confirmation,
            user["email"], str(artefact["consent_uuid"]), stopped, continuing,
        )

    return {
        "consent_uuid": artefact["consent_uuid"],
        "supersedes": consent_uuid,
        "withdrawn_at": artefact["affirmative_action_at"],
        "stopped": stopped,
        "continuing": continuing,
        "continuing_under_other_basis": other_basis,
        "note": (
            "Processing for the purposes listed under 'stopped' ceases within a "
            "reasonable period. Data already collected is not deleted by this "
            "withdrawal - to ask for erasure, make a rights request."
        ),
    }
