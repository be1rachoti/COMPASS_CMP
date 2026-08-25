"""Middleware - the outermost layer of the request pipeline.

Order matters and is asserted by the order of `install()`. Starlette runs
middleware in reverse registration order on the way in, so the last one added is
the first one entered. Reading `install()` bottom-up gives the inbound order:

    request id  ->  security headers  ->  body limit  ->  access log

The request id must be first: everything after it, including the failure of
anything after it, needs somewhere to record which request it was.
"""

from __future__ import annotations

import time
from collections.abc import Awaitable, Callable

from fastapi import FastAPI, Request, Response, status
from fastapi.responses import ORJSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from cmp.core.config import settings
from cmp.core.context import RequestContext, new_request_id, reset_context, set_context
from cmp.core.logging import get_logger

log = get_logger("cmp.api")

Next = Callable[[Request], Awaitable[Response]]

REQUEST_ID_HEADER = "X-Request-ID"

# Paths that must never appear in a log line with their parameters intact. The
# consent token is a capability: anything that can read the access log can
# impersonate the link.
_SENSITIVE_PATH_PREFIXES = ("/c/",)


class RequestContextMiddleware(BaseHTTPMiddleware):
    """Establish the correlation id and the audit context for this request.

    An inbound `X-Request-ID` is honoured so a trace started at the proxy or in
    the browser survives into our logs - but it is bounded and sanitised, because
    it ends up in log lines and must not be able to inject one.
    """

    async def dispatch(self, request: Request, call_next: Next) -> Response:
        incoming = request.headers.get(REQUEST_ID_HEADER, "")
        request_id = _clean_request_id(incoming) or new_request_id()

        token = set_context(
            RequestContext(
                request_id=request_id,
                ip_address=_client_ip(request),
                user_agent=request.headers.get("user-agent", "")[:300] or None,
            )
        )
        request.state.request_id = request_id
        try:
            response = await call_next(request)
        finally:
            reset_context(token)
        response.headers[REQUEST_ID_HEADER] = request_id
        return response


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


class BodyLimitMiddleware(BaseHTTPMiddleware):
    """Refuse oversized bodies before they are read into memory.

    Nginx enforces the same cap in front. Both, because the application is also
    reachable directly in development and in a container-to-container call, and
    a limit that only exists in the proxy is a limit that disappears the moment
    someone bypasses the proxy.
    """

    async def dispatch(self, request: Request, call_next: Next) -> Response:
        declared = request.headers.get("content-length")
        if declared is not None:
            try:
                if int(declared) > settings.max_upload_bytes:
                    return _too_large()
            except ValueError:
                return ORJSONResponse(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    content={
                        "error": {
                            "code": "bad_request",
                            "message": "Malformed Content-Length",
                            "request_id": getattr(request.state, "request_id", "-"),
                        }
                    },
                )
        return await call_next(request)


def _too_large() -> ORJSONResponse:
    from cmp.core.context import current_context

    return ORJSONResponse(
        status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
        content={
            "error": {
                "code": "payload_too_large",
                "message": (
                    f"Request body exceeds {settings.max_upload_bytes // (1024 * 1024)} MB"
                ),
                "request_id": current_context().request_id,
            }
        },
    )


class AccessLogMiddleware(BaseHTTPMiddleware):
    """One structured line per request: method, path, status, latency.

    Uvicorn's own access log is disabled in `configure_logging` - two access logs
    in different formats is worse than either alone.
    """

    async def dispatch(self, request: Request, call_next: Next) -> Response:
        started = time.perf_counter()
        try:
            response = await call_next(request)
        except Exception:
            log.error(
                "request.errored",
                method=request.method,
                endpoint=_safe_path(request.url.path),
                latency_ms=round((time.perf_counter() - started) * 1000, 2),
            )
            raise

        latency_ms = round((time.perf_counter() - started) * 1000, 2)
        # Health checks at 10s intervals would drown everything else.
        if request.url.path not in ("/health", "/health/live", "/health/ready", "/ready"):
            log.info(
                "request.completed",
                method=request.method,
                endpoint=_safe_path(request.url.path),
                status=response.status_code,
                latency_ms=latency_ms,
            )
        response.headers["X-Response-Time-ms"] = str(latency_ms)
        return response


def _safe_path(path: str) -> str:
    """Scrub capability tokens out of anything that gets logged."""
    for prefix in _SENSITIVE_PATH_PREFIXES:
        if path.startswith(prefix):
            rest = path[len(prefix) :]
            tail = rest.partition("/")[2]
            return f"{prefix}[token]" + (f"/{tail}" if tail else "")
    return path


def _clean_request_id(value: str) -> str:
    """Bound and sanitise a client-supplied id before it reaches a log line."""
    allowed = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_"
    cleaned = "".join(c for c in value if c in allowed)[:64]
    return cleaned


def _client_ip(request: Request) -> str | None:
    """The client address, trusting the proxy only where we run one.

    `X-Forwarded-For` is client-controlled unless something in front overwrites
    it. Nginx does; a direct caller does not. Outside production we take the
    socket address, so a developer cannot spoof an address into the audit trail
    by setting a header.
    """
    if settings.is_production:
        forwarded = request.headers.get("x-forwarded-for", "")
        if forwarded:
            return forwarded.split(",")[0].strip()[:45]
    return request.client.host if request.client else None


def install(app: FastAPI) -> None:
    # Registered outermost-last: read bottom-up for inbound order.
    app.add_middleware(AccessLogMiddleware)
    app.add_middleware(BodyLimitMiddleware)
    app.add_middleware(SecurityHeadersMiddleware)
    app.add_middleware(RequestContextMiddleware)
