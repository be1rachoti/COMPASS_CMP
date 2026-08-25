"""System and reference - 5 endpoints.

`/meta/enums` exists because the frontend must not hardcode enum values. When a
status is added, one endpoint changes, not fifteen React components.

Liveness and readiness are genuinely different questions and a load balancer
needs both:

* **Liveness** - is this process alive? If it answers, do not restart it. It must
  not touch the database: a database outage would make every replica fail its
  liveness probe, the orchestrator would restart all of them, and a recoverable
  dependency failure becomes a total outage.
* **Readiness** - can this process serve traffic *right now*? It must touch its
  dependencies. A failing readiness check takes one replica out of rotation and
  leaves it running.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Response, status

from cmp.core.config import settings
from cmp.db import pool
from cmp.db import redis as redis_db
from cmp.domain.state_machine import ALL_STATUSES
from cmp.schemas.common import Out

router = APIRouter(tags=["system"])


class Health(Out):
    status: str
    service: str
    version: str


class ReadyCheck(Out):
    name: str
    ok: bool
    detail: str | None = None


class Ready(Out):
    status: str
    checks: list[ReadyCheck]
    schema_version: str | None = None


class ServiceIndex(Out):
    service: str
    version: str
    environment: str
    status: str
    docs: str | None
    endpoints: dict[str, str]


@router.get("/", response_model=ServiceIndex, include_in_schema=False)
async def index() -> dict[str, Any]:
    """A descriptor at the root.

    Not decoration. Without it, opening the base URL in a browser - the first
    thing anyone does to check whether the API is up - returns a bare 404 that
    is indistinguishable from a dead server. This says what is running and
    where to go next.

    Deliberately lists routes rather than describing them: it is a signpost, not
    documentation, and it exposes nothing that `/docs` does not.
    """
    return {
        "service": settings.service_name,
        "version": settings.version,
        "environment": settings.environment,
        "status": "ok",
        # The interactive docs are a development affordance; in production they
        # are disabled, and pointing at them would be a dead link.
        "docs": None if settings.is_production else "/docs",
        "endpoints": {
            "liveness": "/health",
            "readiness": "/ready",
            "enums": "/meta/enums",
            "rights": "/rights",
            "sign_in": "/auth/login",
            "who_am_i": "/auth/me",
        },
    }


@router.get("/health", response_model=Health, summary="Liveness")
async def health() -> dict[str, str]:
    """Process is up. No dependency is consulted - see the module docstring."""
    return {"status": "ok", "service": settings.service_name, "version": settings.version}


# The checklist names /health/live and /health/ready; a load balancer configured
# against /ready should not 404 either. Same handlers, both spellings.
@router.get("/health/live", response_model=Health, include_in_schema=False)
async def health_live() -> dict[str, str]:
    return await health()


@router.get("/ready", response_model=Ready, summary="Readiness")
async def ready(response: Response) -> dict[str, Any]:
    """Database reachable, migrations current, Redis reachable."""
    db_ok = await pool.healthcheck()
    redis_ok = await redis_db.healthcheck()
    version = await pool.schema_version() if db_ok else None

    checks = [
        ReadyCheck(name="postgresql", ok=db_ok, detail=None if db_ok else "unreachable"),
        ReadyCheck(name="redis", ok=redis_ok, detail=None if redis_ok else "unreachable"),
        ReadyCheck(
            name="migrations",
            ok=version is not None,
            detail=None if version else "no alembic_version row; run alembic upgrade head",
        ),
    ]
    all_ok = all(c.ok for c in checks)
    if not all_ok:
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE

    return {
        "status": "ready" if all_ok else "not_ready",
        "checks": [c.model_dump() for c in checks],
        "schema_version": version,
    }


@router.get("/health/ready", include_in_schema=False)
async def health_ready(response: Response) -> dict[str, Any]:
    return await ready(response)


class Version(Out):
    service: str
    version: str
    environment: str
    schema_version: str | None = None


@router.get("/meta/version", response_model=Version, tags=["meta"])
async def version() -> dict[str, Any]:
    return {
        "service": settings.service_name,
        "version": settings.version,
        "environment": settings.environment,
        "schema_version": await pool.schema_version(),
    }


# Mirrors the enums in DATA-MODEL.md. Kept in one place so a new status is one
# edit here rather than a hunt through the frontend.
_ENUMS: dict[str, list[str]] = {
    "user_role": ["dpo", "dco", "rnd_user", "admin", "data_subject"],
    "person_type": ["external", "employee", "ex_employee", "vendor"],
    "user_status": ["pending", "active", "suspended", "deactivated"],
    "project_status": list(ALL_STATUSES),
    "purpose_status": ["draft", "pending_approval", "active", "retired"],
    "notice_status": ["draft", "approved", "published", "superseded"],
    "lawful_basis": ["consent_s6", "legitimate_use_s7"],
    "s7_clause": ["s7_a_voluntary", "s7_i_employment", "s7_other"],
    "retention_basis": ["statutory", "contractual", "business_policy"],
    "erasure_trigger": ["withdrawal", "purpose_served", "period_elapsed", "inactivity"],
    "lapse_behaviour": ["quarantine", "erase", "none"],
    "change_class": ["material", "superficial"],
    "language_code": [
        "english", "hindi", "marathi", "tamil", "telugu", "kannada", "bengali", "gujarati",
    ],
    "processor_type": ["lab", "tool", "other"],
    "record_status": ["active", "suspended", "terminated"],
    "approval_type": ["security", "legal", "other"],
    "link_status": ["active", "expired", "revoked"],
    "action_type": ["checkbox_click", "button_press", "signature"],
    "export_type": ["collection_pack", "consented_list"],
    "source_role": ["identity", "collection", "both"],
    "exchange_mode": ["file_export", "file_import", "manual_upload", "api"],
    "batch_status": ["received", "validating", "accepted", "partial", "rejected"],
    "asset_type": ["image", "video", "audio", "sensor", "document", "other"],
    "subject_role": ["consented", "incidental", "unidentified"],
    "disposition": ["active", "redacted", "erased", "quarantined"],
}

# Human labels live with the values so a dropdown does not need a second lookup
# table in the frontend that drifts out of sync with this one.
_LABELS: dict[str, str] = {
    "dpo": "Data Protection Officer",
    "dco": "Data Collection Owner",
    "rnd_user": "R&D User",
    "admin": "Administrator",
    "data_subject": "Data Subject",
    "in_draft": "In Draft",
    "under_process": "Under Process",
    "pending_approval": "Pending Approval",
    "approved": "Approved",
    "closed": "Closed",
    "consent_s6": "Consent (s.6)",
    "legitimate_use_s7": "Certain Legitimate Uses (s.7)",
    "s7_a_voluntary": "s.7(a) - voluntarily provided",
    "s7_i_employment": "s.7(i) - employment purposes",
    "s7_other": "s.7 - other specified use",
    "collection_pack": "Collection pack (no personal data)",
    "consented_list": "Consented list",
    "file_export": "File export",
    "file_import": "File import",
    "manual_upload": "Manual upload",
    "api": "API",
}


class EnumValue(Out):
    value: str
    label: str


@router.get("/meta/enums", tags=["meta"], summary="All enum values for dropdowns")
async def meta_enums() -> dict[str, list[dict[str, str]]]:
    return {
        name: [{"value": v, "label": _LABELS.get(v, _humanise(v))} for v in values]
        for name, values in _ENUMS.items()
    }


def _humanise(value: str) -> str:
    return value.replace("_", " ").capitalize()


# Controlled vocabulary for purpose.data_categories (Rule 3(b)(i): itemised).
# Free text here would produce "phone", "Phone no", "mobile number" as three
# different categories, and a rights request would have to match all three.
_DATA_CATEGORIES: list[dict[str, str]] = [
    {"value": "name", "label": "Name", "group": "identity"},
    {"value": "email", "label": "Email address", "group": "contact"},
    {"value": "mobile", "label": "Mobile number", "group": "contact"},
    {"value": "postal_address", "label": "Postal address", "group": "contact"},
    {"value": "date_of_birth", "label": "Date of birth", "group": "identity"},
    {"value": "gender", "label": "Gender", "group": "identity"},
    {"value": "government_id", "label": "Government identifier", "group": "identity"},
    {"value": "employee_id", "label": "Employee identifier", "group": "identity"},
    {"value": "facial_image", "label": "Facial image", "group": "biometric"},
    {"value": "voice_recording", "label": "Voice recording", "group": "biometric"},
    {"value": "fingerprint", "label": "Fingerprint", "group": "biometric"},
    {"value": "gait_video", "label": "Gait or motion video", "group": "biometric"},
    {"value": "health_data", "label": "Health data", "group": "sensitive"},
    {"value": "location", "label": "Location", "group": "behavioural"},
    {"value": "device_identifier", "label": "Device identifier", "group": "technical"},
    {"value": "ip_address", "label": "IP address", "group": "technical"},
    {"value": "sensor_reading", "label": "Sensor reading", "group": "technical"},
    {"value": "usage_log", "label": "Usage log", "group": "behavioural"},
]


@router.get("/meta/data-categories", tags=["meta"], summary="Controlled vocabulary")
async def meta_data_categories() -> dict[str, list[dict[str, str]]]:
    return {"items": _DATA_CATEGORIES}
