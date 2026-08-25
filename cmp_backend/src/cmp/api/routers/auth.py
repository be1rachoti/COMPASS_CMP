"""Authentication and session - 12 endpoints.

Staff sign-in is two-step where MFA applies: `/auth/login` returns
`mfa_required: true` and a partial session that authorises only
`/auth/mfa/verify`. No other endpoint accepts it.
"""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, Request, Response, status
from pydantic import EmailStr, Field

from cmp.api.deps import (
    CurrentUser,
    PartialUser,
    clear_session_cookies,
    set_session_cookies,
)
from cmp.core.config import settings
from cmp.core.errors import NotFound, Unauthenticated
from cmp.db.pool import connection, transaction
from cmp.domain import audit, sessions
from cmp.domain import auth as auth_service
from cmp.domain.audit import Event
from cmp.schemas.common import Acknowledged, OtpCode, Out, Password, Schema

router = APIRouter(prefix="/auth", tags=["auth"])


# ------------------------------------------------------------------- schemas
class LoginRequest(Schema):
    login: Annotated[str, Field(min_length=3, max_length=255, description="Email or username")]
    password: Annotated[str, Field(min_length=1, max_length=128)]


class LoginResponse(Out):
    mfa_required: bool
    user_uuid: UUID | None = None
    message: str


class MfaVerifyRequest(Schema):
    code: OtpCode


class OtpRequestBody(Schema):
    contact: Annotated[str, Field(min_length=3, max_length=255,
                                  description="Registered email or mobile")]


class OtpVerifyBody(Schema):
    contact: Annotated[str, Field(min_length=3, max_length=255)]
    code: OtpCode


class MeResponse(Out):
    uuid: UUID
    full_name: str
    email: str
    role: str
    person_type: str | None
    status: str
    mfa_verified: bool
    session_expires_at: datetime
    nav: list[str]


class PasswordChange(Schema):
    current_password: Annotated[str, Field(min_length=1, max_length=128)]
    new_password: Password


class ResetRequest(Schema):
    email: EmailStr


class ResetConfirm(Schema):
    email: EmailStr
    code: OtpCode
    new_password: Password


class SessionInfo(Out):
    uuid: UUID
    created_at: datetime
    last_seen_at: datetime
    expires_at: datetime
    ip_address: str | None
    user_agent: str | None
    mfa_verified: bool
    current: bool = False


# --------------------------------------------------------------------- routes
@router.post("/login", response_model=LoginResponse, summary="Staff sign-in")
async def login(body: LoginRequest, request: Request, response: Response) -> dict[str, Any]:
    async with transaction() as conn:
        result = await auth_service.authenticate(
            conn,
            login=body.login,
            password=body.password,
            ip_address=request.client.host if request.client else None,
            user_agent=request.headers.get("user-agent"),
        )

    set_session_cookies(
        response,
        result["token"],
        result["session"].csrf_token,
        max_age=result["max_age"],
    )
    if result["mfa_required"]:
        return {
            "mfa_required": True,
            "user_uuid": result["user"]["uuid"],
            "message": "A verification code has been sent.",
        }
    return {"mfa_required": False, "user_uuid": result["user"]["uuid"], "message": "Signed in."}


@router.post("/mfa/verify", response_model=Acknowledged, summary="Complete stepped-up sign-in")
async def mfa_verify(
    body: MfaVerifyRequest, request: Request, response: Response, principal: PartialUser
) -> dict[str, Any]:
    token = request.cookies.get(settings.cookie_name)
    if not token:
        raise Unauthenticated("Sign in to continue")

    async with transaction() as conn:
        result = await auth_service.verify_mfa(
            conn, user_uuid=principal.uuid, code=body.code, token=token
        )

    set_session_cookies(
        response, token, result["session"].csrf_token, max_age=result["max_age"]
    )
    return {"ok": True, "message": "Verified."}


@router.post("/mfa/resend", response_model=Acknowledged, summary="Resend the MFA code")
async def mfa_resend(principal: PartialUser) -> dict[str, Any]:
    async with connection() as conn:
        from cmp.db.repositories import users as user_repo

        user = await user_repo.by_id(conn, principal.user_id)
        if not user:
            raise Unauthenticated("Sign in to continue")
        await auth_service.resend_mfa(conn, user_uuid=principal.uuid, email=user["email"])
    return {"ok": True, "message": "A new code has been sent."}


@router.post("/otp/request", response_model=Acknowledged, summary="Data-subject sign-in code")
async def otp_request(body: OtpRequestBody) -> dict[str, Any]:
    async with transaction() as conn:
        await auth_service.request_subject_otp(conn, contact=body.contact)
    # Identical response whether or not the contact is registered.
    return {"ok": True, "message": "If that contact is registered, a code has been sent."}


@router.post("/otp/verify", response_model=Acknowledged, summary="Data-subject sign-in")
async def otp_verify(
    body: OtpVerifyBody, request: Request, response: Response
) -> dict[str, Any]:
    async with transaction() as conn:
        result = await auth_service.verify_subject_otp(
            conn,
            contact=body.contact,
            code=body.code,
            ip_address=request.client.host if request.client else None,
            user_agent=request.headers.get("user-agent"),
        )
    set_session_cookies(
        response, result["token"], result["session"].csrf_token, max_age=result["max_age"]
    )
    return {"ok": True, "message": "Signed in."}


@router.post("/logout", response_model=Acknowledged, summary="End this session")
async def logout(request: Request, response: Response, principal: CurrentUser) -> dict[str, Any]:
    token = request.cookies.get(settings.cookie_name)
    if token:
        await sessions.destroy(token)
    async with transaction() as conn:
        await audit.record(
            conn,
            event=Event.LOGOUT,
            entity_type="auth_user",
            entity_id=principal.user_id,
            subject_user_id=principal.user_id,
        )
    clear_session_cookies(response)
    return {"ok": True, "message": "Signed out."}


@router.get("/me", response_model=MeResponse, summary="Who is signed in")
async def me(principal: CurrentUser) -> dict[str, Any]:
    """The endpoint the SPA cannot work without.

    Identity, role, permitted navigation and session expiry. Without it React
    cannot decide what to render on first paint, and every other call becomes
    guesswork.
    """
    async with connection() as conn:
        return await auth_service.me_payload(
            conn, user_id=principal.user_id, session=principal.session
        )


@router.post("/password/change", response_model=Acknowledged)
async def password_change(body: PasswordChange, principal: CurrentUser) -> dict[str, Any]:
    async with transaction() as conn:
        await auth_service.change_password(
            conn,
            user_id=principal.user_id,
            current_password=body.current_password,
            new_password=body.new_password,
        )
    return {"ok": True, "message": "Password changed. Other sessions have been signed out."}


@router.post("/password/reset/request", response_model=Acknowledged)
async def password_reset_request(body: ResetRequest) -> dict[str, Any]:
    async with transaction() as conn:
        await auth_service.request_password_reset(conn, email=str(body.email))
    return {"ok": True, "message": "If that account exists, a reset code has been sent."}


@router.post("/password/reset/confirm", response_model=Acknowledged)
async def password_reset_confirm(body: ResetConfirm) -> dict[str, Any]:
    async with transaction() as conn:
        await auth_service.confirm_password_reset(
            conn, email=str(body.email), code=body.code, new_password=body.new_password
        )
    return {"ok": True, "message": "Password reset. Sign in with your new password."}


@router.get("/sessions", response_model=list[SessionInfo], summary="Your active sessions")
async def list_sessions(principal: CurrentUser) -> list[dict[str, Any]]:
    live = await sessions.list_for_user(principal.user_id)
    return [
        {**s.to_public(), "current": s.sid == principal.session.sid} for s in live
    ]


@router.delete(
    "/sessions/{session_uuid}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Revoke one of your sessions",
)
async def revoke_session(session_uuid: UUID, principal: CurrentUser, response: Response) -> None:
    """Scoped to the caller's own sessions.

    Without the ownership predicate, knowing a session uuid would be enough to
    sign anybody out.
    """
    revoked = await sessions.revoke_by_sid(principal.user_id, str(session_uuid))
    if not revoked:
        raise NotFound("Session")

    async with transaction() as conn:
        await audit.record(
            conn,
            event=Event.USER_SESSIONS_REVOKED,
            entity_type="auth_user",
            entity_id=principal.user_id,
            subject_user_id=principal.user_id,
            detail={"session": str(session_uuid), "self_service": True},
        )
    if str(session_uuid) == principal.session.sid:
        clear_session_cookies(response)
