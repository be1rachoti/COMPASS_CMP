"""Turning a cookie into a session, and a session into cookies.

The session token lives in an **HttpOnly** cookie, which is the whole point:
JavaScript cannot read it, so an XSS bug in the console cannot exfiltrate it.
That also means the browser sends it automatically, which is what makes CSRF a
problem — see `csrf.py` for the other half.

`SameSite=Lax` plus a first-party proxy is what makes the cookie arrive at all.
A browser on `localhost:3000` talking to an API on `127.0.0.1:8000` is a
*cross-site* request as far as the cookie is concerned, and the cookie is
silently dropped — which presents as a login that returns 200 and then 401s on
the next call. The console proxies `/api/*` for exactly this reason.
"""

from __future__ import annotations

from typing import Any

from fastapi import Request

from cmp.api.dependencies.csrf import UNSAFE_METHODS
from cmp.auth.sessions import service as sessions
from cmp.auth.sessions.service import Session
from cmp.core.config import settings
from cmp.core.errors import Forbidden, Unauthenticated
from cmp.core.security import csrf_matches


async def session_from_request(request: Request) -> Session:
    token = request.cookies.get(settings.cookie_name)
    if not token:
        raise Unauthenticated("Sign in to continue")

    session = await sessions.load(token)
    if session is None:
        raise Unauthenticated("Your session has expired")

    # Double-submit CSRF. Checked here rather than in middleware because it needs
    # the session's own token, and because safe methods must be exempt.
    if request.method in UNSAFE_METHODS:
        header = request.headers.get(settings.csrf_header_name)
        if not csrf_matches(session.csrf_token, header):
            raise Forbidden("Missing or invalid CSRF token", code="csrf_failed")

    return session


def set_session_cookies(response: Any, token: str, csrf_token: str, *, max_age: int) -> None:
    """Two cookies, deliberately different.

    The session cookie is HttpOnly so script cannot read it. The CSRF cookie must
    be readable by script - that is the whole mechanism: the page reads it and
    echoes it in a header, which a cross-origin page cannot do.
    """
    response.set_cookie(
        settings.cookie_name,
        token,
        max_age=max_age,
        httponly=True,
        secure=settings.cookie_secure,
        samesite=settings.cookie_samesite,
        domain=settings.cookie_domain,
        path="/",
    )
    response.set_cookie(
        settings.csrf_cookie_name,
        csrf_token,
        max_age=max_age,
        httponly=False,
        secure=settings.cookie_secure,
        samesite=settings.cookie_samesite,
        domain=settings.cookie_domain,
        path="/",
    )


def clear_session_cookies(response: Any) -> None:
    for name in (settings.cookie_name, settings.csrf_cookie_name):
        response.delete_cookie(
            name,
            domain=settings.cookie_domain,
            path="/",
            secure=settings.cookie_secure,
            samesite=settings.cookie_samesite,
        )
