"""The audit trail.

Built second, before any resource that writes. Retrofitting audit coverage across
a finished codebase means hand-checking every write path, and missing some.

Three rules this module exists to hold:

1. **Only services record.** A router that writes to the database bypasses the
   audit call; that is how audit trails end up patchy. `record()` takes the
   connection the service is already inside, so the audit row and the change it
   describes commit or roll back together. An audited change that rolled back is
   a lie, and a change that committed without its audit row is worse.

2. **`entity_type` is the table name, exactly.** Free text produces
   `consent_artefact`, `ConsentArtefact` and `consent` in the same column within a
   month, and the rights-request query then silently misses rows. The vocabulary
   below is closed and validated.

3. **Actor and subject are different people.** When a DCO runs an export the
   actor is the DCO and the subject is null. When a data subject withdraws, both
   are her. Confusing the two makes the DSAR query wrong in the direction that
   under-reports.
"""

from __future__ import annotations

import json
from typing import Any, Final

from psycopg.types.json import Jsonb

from cmp.core.context import current_context
from cmp.core.logging import get_logger
from cmp.db.sql import Conn, fetch_all, fetch_one

log = get_logger("cmp.audit")

# The table names that may appear in audit_log.entity_type. Exactly the 22 tables
# of DATA-MODEL.md - no display names, no aggregates, no invented nouns.
ENTITY_TYPES: Final[frozenset[str]] = frozenset(
    {
        "auth_user",
        "person_type_history",
        "processor",
        "data_source",
        "purpose",
        "project",
        "project_status_history",
        "project_approval",
        "project_site",
        "notice",
        "notice_purpose",
        "notice_language",
        "consent_link",
        "consent_artefact",
        "consent_purpose_grant",
        "export_log",
        "export_line",
        "import_batch",
        "collection",
        "data_asset",
        "asset_consent",
        "audit_log",
    }
)


class Event:
    """Closed event vocabulary.

    Grouped by the resource they concern. Adding one means adding it here, which
    is the point: a grep for `Event.` enumerates everything the platform claims
    to have recorded.
    """

    # accounts
    USER_CREATED = "user.created"
    USER_UPDATED = "user.updated"
    USER_ROLE_CHANGED = "user.role_changed"
    USER_DEACTIVATED = "user.deactivated"
    USER_REACTIVATED = "user.reactivated"
    USER_PERSON_TYPE_CHANGED = "user.person_type_changed"
    USER_MFA_RESET = "user.mfa_reset"
    USER_SESSIONS_REVOKED = "user.sessions_revoked"

    # authentication
    LOGIN_SUCCEEDED = "auth.login_succeeded"
    LOGIN_FAILED = "auth.login_failed"
    LOGIN_LOCKED_OUT = "auth.login_locked_out"
    MFA_VERIFIED = "auth.mfa_verified"
    MFA_FAILED = "auth.mfa_failed"
    OTP_REQUESTED = "auth.otp_requested"
    OTP_VERIFIED = "auth.otp_verified"
    OTP_FAILED = "auth.otp_failed"
    LOGOUT = "auth.logout"
    PASSWORD_CHANGED = "auth.password_changed"
    PASSWORD_RESET_REQUESTED = "auth.password_reset_requested"
    PASSWORD_RESET_COMPLETED = "auth.password_reset_completed"
    ACCESS_DENIED = "auth.access_denied"  # every 403 is audited

    # registry
    PURPOSE_CREATED = "purpose.created"
    PURPOSE_UPDATED = "purpose.updated"
    PURPOSE_ACTIVATED = "purpose.activated"
    PURPOSE_RETIRED = "purpose.retired"
    PROCESSOR_CREATED = "processor.created"
    PROCESSOR_UPDATED = "processor.updated"
    PROCESSOR_SUSPENDED = "processor.suspended"
    SOURCE_CREATED = "source.created"
    SOURCE_UPDATED = "source.updated"
    SOURCE_SUSPENDED = "source.suspended"

    # projects
    PROJECT_CREATED = "project.created"
    PROJECT_UPDATED = "project.updated"
    PROJECT_TRANSITIONED = "project.transitioned"
    PROJECT_DCO_ASSIGNED = "project.dco_assigned"
    PROJECT_CLOSED = "project.closed"
    APPROVAL_UPLOADED = "approval.uploaded"
    APPROVAL_PROOF_DOWNLOADED = "approval.proof_downloaded"
    SITE_CREATED = "site.created"
    SITE_UPDATED = "site.updated"
    SITE_DEACTIVATED = "site.deactivated"
    SITE_AGENT_ASSIGNED = "site.agent_assigned"
    #: A site changed hands. The project follows it, so this event is the record
    #: of *why* a project appeared in somebody else's list.
    SITE_DCO_ASSIGNED = "site.dco_assigned"
    #: A capability link was replaced: the old one revoked, a new one minted.
    #: Two events would be truthful and would separate a single decision.
    LINK_REMINTED = "link.reminted"

    # delegation
    DELEGATION_GRANTED = "delegation.granted"
    DELEGATION_REVOKED = "delegation.revoked"

    # notices
    NOTICE_CREATED = "notice.created"
    NOTICE_UPDATED = "notice.updated"
    NOTICE_PURPOSE_ATTACHED = "notice.purpose_attached"
    NOTICE_PURPOSE_DETACHED = "notice.purpose_detached"
    #: Rule 3(b) narrowed for one notice, without touching the shared purpose.
    NOTICE_PURPOSE_OVERRIDDEN = "notice.purpose_overridden"
    NOTICE_LANGUAGE_ADDED = "notice.language_added"
    NOTICE_LANGUAGE_UPDATED = "notice.language_updated"
    NOTICE_LANGUAGE_APPROVED = "notice.language_approved"
    NOTICE_PUBLISHED = "notice.published"
    NOTICE_SUPERSEDED = "notice.superseded"

    # consent
    LINK_CREATED = "link.created"
    LINK_REVOKED = "link.revoked"
    LINK_OPENED = "link.opened"
    SUBJECT_REGISTERED = "subject.registered"
    NOTICE_SERVED = "notice.served"
    CONSENT_GIVEN = "consent.given"
    CONSENT_DECLINED = "consent.declined"
    CONSENT_WITHDRAWN = "consent.withdrawn"

    # exchange
    EXPORT_GENERATED = "export.generated"
    EXPORT_DOWNLOADED = "export.downloaded"
    IMPORT_VALIDATED = "import.validated"
    IMPORT_RECEIVED = "import.received"
    IMPORT_ACCEPTED = "import.accepted"
    IMPORT_REJECTED = "import.rejected"
    ASSET_DISPOSITION_CHANGED = "asset.disposition_changed"

    # platform
    AUDIT_VERIFIED = "audit.verified"


_INSERT = """
INSERT INTO audit_log (event_type, actor_user_id, subject_user_id,
                       entity_type, entity_id, detail_json)
VALUES (%s, %s, %s, %s, %s, %s)
RETURNING log_id, log_uuid, occurred_at
"""


async def record(
    conn: Conn,
    *,
    event: str,
    entity_type: str,
    entity_id: int,
    subject_user_id: int | None = None,
    actor_user_id: int | None = None,
    detail: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Write one audit row on the caller's connection, inside the caller's transaction.

    `actor_user_id` defaults to the authenticated actor from the request context.
    Pass it explicitly only where there is no request - a Celery beat sweep acts
    as the system, and a system action has no actor rather than a fake one.
    """
    if entity_type not in ENTITY_TYPES:
        # A programming error, and one that silently corrupts the DSAR query if
        # it reaches production. Fail here, in review and in tests, not there.
        raise ValueError(
            f"entity_type must be a table name; {entity_type!r} is not one of the 22 tables"
        )

    ctx = current_context()
    actor = actor_user_id if actor_user_id is not None else ctx.actor_user_id

    payload: dict[str, Any] = dict(detail or {})
    payload.setdefault("request_id", ctx.request_id)
    if ctx.ip_address:
        payload.setdefault("ip", ctx.ip_address)

    row = await fetch_one(
        conn,
        _INSERT,
        (event, actor, subject_user_id, entity_type, entity_id, Jsonb(payload)),
    )
    assert row is not None  # RETURNING on a successful INSERT always yields a row

    log.info(
        "audit.recorded",
        event_type=event,
        entity_type=entity_type,
        entity_id=entity_id,
        subject_user_id=subject_user_id,
    )
    return row


async def record_denial(
    conn: Conn, *, resource: str, entity_id: int = 0, reason: str = "not permitted"
) -> None:
    """Every 403 is audited (API reference §1.4).

    A refusal is evidence of an attempt. The pattern of attempts is what shows a
    compromised account before the successful call does.
    """
    ctx = current_context()
    await record(
        conn,
        event=Event.ACCESS_DENIED,
        entity_type="auth_user",
        entity_id=ctx.actor_user_id or 0,
        detail={
            "resource": resource,
            "target_id": entity_id,
            "reason": reason,
            "role": ctx.actor_role,
        },
    )


_VERIFY = "SELECT * FROM cmp_audit_verify(%s)"
_COUNT = "SELECT count(*) AS n, max(log_id) AS last_id FROM audit_log"


async def verify_chain(conn: Conn, *, from_log_id: int = 0) -> dict[str, Any]:
    """Recompute the hash chain. Backs GET /audit/verify.

    Each row carries a digest over its own content and its predecessor's digest.
    Editing row N changes its digest, which no longer matches what N+1 recorded,
    and every row after it fails too - so the answer is not "something changed"
    but "the trail is sound up to exactly here".
    """
    breaks = await fetch_all(conn, _VERIFY, (from_log_id,))
    totals = await fetch_one(conn, _COUNT) or {"n": 0, "last_id": None}
    return {
        "intact": not breaks,
        "rows_checked": totals["n"],
        "last_log_id": totals["last_id"],
        "first_break": breaks[0] if breaks else None,
    }


def canonical_detail(value: Any) -> str:
    """Stable JSON for anything that must hash identically twice."""
    return json.dumps(value, sort_keys=True, separators=(",", ":"), default=str)
