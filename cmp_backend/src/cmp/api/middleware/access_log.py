"""One structured line per request.

Method, scrubbed path, status, latency and the correlation id. Enough to answer
"what happened to request X" without being a second copy of the audit trail —
the audit trail records *what was done to data*; this records *what was asked
of the server*.

The path is scrubbed through `safe_path` before it is logged. A consent link
token in an access log is a credential in a file that gets shipped to a log
aggregator and read by people who were never meant to hold it.
"""

from __future__ import annotations

import time
from collections.abc import Awaitable, Callable

from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware

from cmp.api.middleware.request_context import safe_path
from cmp.core.constants import RESPONSE_TIME_HEADER
from cmp.core.logging import get_logger

log = get_logger("cmp.api")

Next = Callable[[Request], Awaitable[Response]]


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
                endpoint=safe_path(request.url.path),
                latency_ms=round((time.perf_counter() - started) * 1000, 2),
            )
            raise

        latency_ms = round((time.perf_counter() - started) * 1000, 2)
        # Health checks at 10s intervals would drown everything else.
        if request.url.path not in ("/health", "/health/live", "/health/ready", "/ready"):
            log.info(
                "request.completed",
                method=request.method,
                endpoint=safe_path(request.url.path),
                status=response.status_code,
                latency_ms=latency_ms,
            )
        response.headers[RESPONSE_TIME_HEADER] = str(latency_ms)
        return response
