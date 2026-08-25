"""The public consent flow - the six endpoints a data subject actually uses.

`POST /c/{token}/consent` takes the subject from the session established by OTP
verification, never from the request body. There is no code path by which any
other role records consent for someone else.

`Referrer-Policy: no-referrer` is set on every `/c/` response and the token is
scrubbed from access logs (`cmp.api.middleware._safe_path`). A capability token
that leaks through a referer header or an access log is a capability anyone who
reads that log now holds.
"""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, Request, Response, status
from pydantic import EmailStr, Field

from cmp.api.dependencies import set_session_cookies
from cmp.auth.rate_limit import service as ratelimit
from cmp.auth.sessions import service as sessions
from cmp.core.config import settings
from cmp.core.errors import Unauthenticated
from cmp.core.permissions import Role
from cmp.db.pool import transaction
from cmp.db.repositories import notices as notice_repo
from cmp.domain import audit
from cmp.domain import consent as service
from cmp.domain.audit import Event
from cmp.schemas.common import Acknowledged, Mobile, OtpCode, Out, Schema, ShortText

router = APIRouter(tags=["public consent"])

# A token is 43 url-safe characters from 32 random bytes; bound it so a
# pathological path cannot reach the database at all.
TokenPath = Annotated[str, Field(min_length=20, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")]


class LinkView(Out):
    valid: bool
    project_name: str
    site_label: str
    notice_uuid: UUID
    available_languages: list[str]
    already_registered: bool = False


class RegisterBody(Schema):
    full_name: ShortText
    email: EmailStr
    mobile: Mobile | None = None
    organization_id: Annotated[str | None, Field(default=None, max_length=60)] = None
    person_type: str | None = None


class OtpBody(Schema):
    contact: Annotated[str, Field(min_length=3, max_length=255)]


class OtpVerifyBody(Schema):
    contact: Annotated[str, Field(min_length=3, max_length=255)]
    code: OtpCode


class ConsentBody(Schema):
    language_code: str
    served_at: datetime
    grants: dict[UUID, bool] = Field(
        description="Every purpose on the notice must carry an explicit answer"
    )
    action_type: str = "checkbox_click"


def _no_referrer(response: Response) -> None:
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, private"


@router.get("/c/{token}", response_model=LinkView, summary="Validate the link")
async def open_link(token: TokenPath, request: Request, response: Response) -> dict[str, Any]:
    """An invalid link returns a plain message and renders no notice content."""
    _no_referrer(response)
    await ratelimit.enforce(
        "public_link", request.client.host if request.client else "unknown",
        limit=settings.public_link_rate_per_minute, window_s=60, fail_open=False,
    )

    async with transaction() as conn:
        link = await service.resolve_link(conn, token)
        languages = await notice_repo.languages_of(conn, link["notice_id"])
        await audit.record(
            conn, event=Event.LINK_OPENED, entity_type="consent_link",
            entity_id=link["link_id"],
        )

    return {
        "valid": True,
        "project_name": link["project_name"],
        "site_label": link["site_label"],
        "notice_uuid": link["notice_uuid"],
        "available_languages": [
            x["language_code"] for x in languages if x["approved_at"] is not None
        ],
    }


@router.post("/c/{token}/register", response_model=Acknowledged,
             status_code=status.HTTP_201_CREATED)
async def register(
    token: TokenPath, body: RegisterBody, response: Response
) -> dict[str, Any]:
    """Create the person and set `registered_via_link_id`."""
    _no_referrer(response)
    async with transaction() as conn:
        result = await service.register_subject(
            conn,
            token=token,
            full_name=body.full_name,
            email=str(body.email),
            mobile=body.mobile,
            organization_id=body.organization_id,
            person_type=body.person_type,
        )
    return {
        "ok": True,
        "message": (
            "Registered. We have sent a code to confirm your contact details."
            if result["created"]
            else "We already have your details. We have sent a code to confirm them."
        ),
    }


@router.post("/c/{token}/otp", response_model=Acknowledged, summary="6-digit code, 10 minutes")
async def request_code(
    token: TokenPath, body: OtpBody, response: Response
) -> dict[str, Any]:
    _no_referrer(response)
    async with transaction() as conn:
        await service.send_contact_code(conn, token=token, contact=body.contact)
    return {"ok": True, "message": "If those details are registered, a code has been sent."}


@router.post("/c/{token}/otp/verify", response_model=Acknowledged,
             summary="5 attempts, then the code is discarded")
async def verify_code(
    token: TokenPath, body: OtpVerifyBody, request: Request, response: Response
) -> dict[str, Any]:
    """Establishes the subject session that `POST /c/{token}/consent` relies on."""
    _no_referrer(response)
    async with transaction() as conn:
        result = await service.verify_contact_code(
            conn, token=token, contact=body.contact, code=body.code
        )

    user = result["user"]
    raw, session = await sessions.create(
        user_id=user["id"],
        user_uuid=str(user["uuid"]),
        role=user["role"],
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
        mfa_verified=True,
    )
    set_session_cookies(response, raw, session.csrf_token, max_age=settings.session_ttl_s)
    return {"ok": True, "message": "Verified. You can now read the notice."}


@router.get("/c/{token}/notice", summary="Render the notice - stamps served_at")
async def serve_notice(
    token: TokenPath,
    request: Request,
    response: Response,
    language_code: str = "english",
) -> dict[str, Any]:
    """The `served_at` in the response is what the consent call must carry back.

    It is generated here, not accepted from the client: a client-supplied
    timestamp could claim the notice was shown at any convenient moment, and
    s.5(1) would become unfalsifiable.
    """
    _no_referrer(response)
    cookie = request.cookies.get(settings.cookie_name)
    session = await sessions.load(cookie) if cookie else None

    async with transaction() as conn:
        return await service.serve_notice(
            conn,
            token=token,
            language_code=language_code,
            user_id=session.user_id if session else None,
        )


@router.post("/c/{token}/consent", status_code=status.HTTP_201_CREATED)
async def give_consent(
    token: TokenPath, body: ConsentBody, request: Request, response: Response
) -> dict[str, Any]:
    """Write the artefact and its grants.

    The subject is taken from the session, never from the body.
    """
    _no_referrer(response)
    cookie = request.cookies.get(settings.cookie_name)
    session = await sessions.load(cookie) if cookie else None
    if session is None:
        raise Unauthenticated("Confirm your contact details before consenting")
    if session.role != Role.DATA_SUBJECT.value:
        # Staff cannot record consent on someone's behalf through this route.
        raise Unauthenticated("This flow is for data subjects only")

    async with transaction() as conn:
        artefact = await service.capture(
            conn,
            token=token,
            user_id=session.user_id,
            language_code=body.language_code,
            served_at=body.served_at,
            grants={str(k): v for k, v in body.grants.items()},
            action_type=body.action_type,
            ip_address=request.client.host if request.client else None,
        )
    return {
        "consent_uuid": artefact["consent_uuid"],
        "recorded_at": artefact["affirmative_action_at"],
        "project_name": artefact["project_name"],
        "message": (
            "Your choices have been recorded. You can review or withdraw them at "
            "any time using the links in the notice."
        ),
    }
