"""Response headers that constrain what a browser will do with our output.

Applied on the way out, to everything. A header set on some responses and not
others is a header an attacker will find the gap in.

The CSP is the one worth reading. This API serves JSON to a separate origin, so
it needs no script, style or image sources at all — `default-src 'none'` is
both the tightest possible policy and, here, the correct one. The interactive
docs are the exception, and they are disabled in production anyway.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable

from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware

from cmp.core.config import settings

Next = Callable[[Request], Awaitable[Response]]


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Headers that cost nothing and close whole classes of attack.

    The API serves JSON, not documents, so the CSP is maximally restrictive: it
    is here to neuter a response that somehow renders, not to permit anything.
    """

    async def dispatch(self, request: Request, call_next: Next) -> Response:
        response = await call_next(request)
        headers = response.headers

        headers.setdefault("X-Content-Type-Options", "nosniff")
        headers.setdefault("X-Frame-Options", "DENY")
        headers.setdefault("Referrer-Policy", "no-referrer")
        headers.setdefault(
            "Content-Security-Policy",
            "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
        )
        headers.setdefault(
            "Permissions-Policy", "geolocation=(), microphone=(), camera=(), payment=()"
        )
        headers.setdefault("Cross-Origin-Opener-Policy", "same-origin")
        headers.setdefault("Cross-Origin-Resource-Policy", "same-origin")

        # An authenticated response is never a cacheable one. A shared cache that
        # keeps one user's project list and serves it to the next is a data
        # breach with a 200 status code.
        if request.url.path.startswith(("/auth", "/me", "/c/")) or "cookie" in request.headers:
            headers.setdefault("Cache-Control", "no-store, no-cache, must-revalidate, private")
            headers.setdefault("Pragma", "no-cache")

        if settings.is_production:
            headers.setdefault(
                "Strict-Transport-Security", "max-age=31536000; includeSubDomains; preload"
            )
        return response
