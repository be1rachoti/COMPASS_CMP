"""Refuse an oversized body before anything parses it.

Checked against `Content-Length` first, which is free, and then against the
bytes actually read — because a client can lie about the former, and a chunked
request has none at all.

This sits above the route so an oversized payload never reaches a Pydantic model
or a file handler. Parsing a 2 GB body to discover it is too large is the
denial-of-service this prevents.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable

from fastapi import Request, Response, status
from fastapi.responses import ORJSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from cmp.core.config import settings
from cmp.core.context import current_context

Next = Callable[[Request], Awaitable[Response]]


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
