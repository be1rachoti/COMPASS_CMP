"""Correlation id and audit context.

The first middleware entered, and it has to be: everything after it — including
the failure of anything after it — needs somewhere to record which request it
was. A traceback with no request id is a traceback nobody can match to the
support ticket that produced it.

The id is bound to a contextvar rather than passed as an argument, because the
alternative is threading it through four hundred function signatures to reach
the one log line at the bottom that needs it.

A client-supplied `X-Request-ID` is honoured so a caller can correlate across
systems, but it is sanitised and bounded first — it reaches a log line, and an
unbounded client-controlled string in a log line is log injection.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable

from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware

from cmp.core.config import settings
from cmp.core.constants import REQUEST_ID_HEADER
from cmp.core.context import RequestContext, new_request_id, reset_context, set_context

Next = Callable[[Request], Awaitable[Response]]

#: Paths whose parameters must never appear intact in a log line. The consent
#: token is a capability: anything that can read the access log could otherwise
#: impersonate the link.
SENSITIVE_PATH_PREFIXES = ("/c/",)


def safe_path(path: str) -> str:
    """Scrub capability tokens out of anything that gets logged."""
    for prefix in SENSITIVE_PATH_PREFIXES:
        if path.startswith(prefix):
            rest = path[len(prefix) :]
            tail = rest.partition("/")[2]
            return f"{prefix}[token]" + (f"/{tail}" if tail else "")
    return path


def clean_request_id(value: str) -> str:
    """Bound and sanitise a client-supplied id before it reaches a log line."""
    allowed = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_"
    return "".join(c for c in value if c in allowed)[:64]


def client_ip(request: Request) -> str | None:
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


class RequestContextMiddleware(BaseHTTPMiddleware):
    """Establish the correlation id and the audit context for this request.

    An inbound `X-Request-ID` is honoured so a trace started at the proxy or in
    the browser survives into our logs - but it is bounded and sanitised, because
    it ends up in log lines and must not be able to inject one.
    """

    async def dispatch(self, request: Request, call_next: Next) -> Response:
        incoming = request.headers.get(REQUEST_ID_HEADER, "")
        request_id = clean_request_id(incoming) or new_request_id()

        token = set_context(
            RequestContext(
                request_id=request_id,
                ip_address=client_ip(request),
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
