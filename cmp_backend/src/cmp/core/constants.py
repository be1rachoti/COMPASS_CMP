"""Values that are facts about the system, not settings.

The difference from `config.py` matters: a setting is something an operator may
reasonably change per environment, and it lives in `Settings` where it can be
overridden by an environment variable. A constant here is something that would
be a *code* change — a table name the audit resolver keys on, a header the
frontend also knows about, a statutory reference.

Putting a statutory clause number in an environment variable would suggest it
can be configured. It cannot.
"""

from __future__ import annotations

from typing import Final

# ================================================================= headers ====
#: Echoed on every response and included in every error body, so a user can quote
#: one string and an operator can find the request.
REQUEST_ID_HEADER: Final = "X-Request-ID"
RESPONSE_TIME_HEADER: Final = "X-Response-Time-ms"

#: On a download: the digest recorded at upload, and the digest of the bytes
#: actually served. A recipient compares them to check that what they received is
#: what was approved.
RECORDED_HASH_HEADER: Final = "X-Recorded-SHA256"
CONTENT_HASH_HEADER: Final = "X-Content-SHA256"

#: An export is a point-in-time snapshot. Withdrawals after it are not reflected,
#: and acting on a stale file is how withdrawn consent gets used.
EXPORT_GENERATED_HEADER: Final = "X-Export-Generated-At"
EXPORT_AGE_HEADER: Final = "X-Export-Age-Days"
EXPORT_STALENESS_HEADER: Final = "X-Export-Staleness-Warning"

#: The age past which an export carries the staleness warning.
EXPORT_STALE_AFTER_DAYS: Final = 7

# ================================================================ statute ====
#: Referenced in messages a data subject reads, so they can look up the clause.
SECTION_NOTICE: Final = "s.5"
SECTION_CONSENT: Final = "s.6"
SECTION_LEGITIMATE_USE: Final = "s.7"
SECTION_ACCESS: Final = "s.11"
SECTION_CORRECTION_ERASURE: Final = "s.12"
SECTION_GRIEVANCE: Final = "s.13"
SECTION_NOMINATION: Final = "s.14"

# ============================================================== evidence ====
#: Tables the database refuses to UPDATE or DELETE. Listed here because more than
#: one place needs to know — the integrity test parametrises over it, and the
#: audit resolver treats a reference into one of these as permanent.
#:
#: Adding a table to this tuple does nothing on its own. The trigger in migration
#: 0002 and the revoked grant in 0003 are what enforce it; this is the roster.
APPEND_ONLY_TABLES: Final[tuple[str, ...]] = (
    "audit_log",
    "consent_artefact",
    "consent_purpose_grant",
    "export_log",
    "export_line",
    "project_status_history",
    "person_type_history",
    "project_approval",
)

#: Events excluded from a data subject's own feed. Her sign-ins are hers and add
#: nothing to "what was done with my data"; including them buries the answer.
SUBJECT_FEED_EXCLUDED_EVENTS: Final[tuple[str, ...]] = (
    "auth.login_succeeded",
    "auth.login_failed",
    "auth.otp_requested",
    "auth.otp_verified",
    "auth.logout",
    "auth.mfa_verified",
)

# ================================================================ limits ====
#: Rows one manifest may declare. Past this it is a bulk load, which is a
#: different conversation with different controls.
MAX_MANIFEST_ROWS: Final = 50_000

#: How many notice code candidates to try before giving up and asking for one.
#: Twenty-six notices for one project in one year is already past the point where
#: the project name is the real problem.
MAX_CODE_COLLISION_ATTEMPTS: Final = 25

#: The bound on a resolved audit page. One query per entity type, not per row —
#: this caps the type count, not the row count.
MAX_ENTITY_RESOLUTION_TYPES: Final = 20
