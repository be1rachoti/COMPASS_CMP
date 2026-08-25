"""Turning an exception into that body.

Four handlers, ordered from most specific to least:

* `cmp_error_handler` — our own hierarchy. These carry their own status and
  code, so the mapping is a lookup rather than a decision.
* `validation_handler` — Pydantic and FastAPI. Rewritten into our shape, with
  the offending field named, because "422 Unprocessable Entity" with a nested
  loc/msg/type array is not something a UI can put next to an input box.
* `http_exception_handler` — Starlette's own, raised by the framework before
  our code runs.
* `unhandled_handler` — the last resort. Logs the traceback and returns a
  generic body: an unexpected exception message can carry a query fragment, a
  file path or a row, and none of those belong in a response.

The request id is on every one of them. A failure a user cannot quote is a
failure an operator cannot find.
"""

from __future__ import annotations

from fastapi import Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import ORJSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from cmp.api.errors.responses import response
from cmp.core.errors import CmpError, RateLimited
from cmp.core.logging import get_logger

log = get_logger("cmp.api.errors")

async def cmp_error_handler(request: Request, exc: Exception) -> ORJSONResponse:
    assert isinstance(exc, CmpError)
    headers: dict[str, str] | None = None
    if isinstance(exc, RateLimited):
        headers = {"Retry-After": str(exc.retry_after_s)}

    logger = log.warning if exc.status_code < 500 else log.error
    logger(
        "request.failed",
        endpoint=request.url.path,
        method=request.method,
        status=exc.status_code,
        error_code=exc.code,
    )
    return response(
        exc.status_code,
        exc.code,
        exc.message,
        field=exc.field,
        extra=exc.details or None,
        headers=headers,
    )


async def validation_handler(request: Request, exc: Exception) -> ORJSONResponse:
    """422 from pydantic, reshaped into the house contract.

    FastAPI's default body is a list of dicts with a `loc` tuple; the SPA would
    need a second parser for it. One shape, one parser - and `field` points at
    the first offending input so a form can highlight it.
    """
    assert isinstance(exc, RequestValidationError)
    errors = exc.errors()
    first = errors[0] if errors else {}
    loc = [str(p) for p in first.get("loc", ()) if p not in ("body", "query", "path")]
    field = ".".join(loc) if loc else None

    log.info(
        "request.invalid",
        endpoint=request.url.path,
        method=request.method,
        field=field,
        error_count=len(errors),
    )
    return response(
        status.HTTP_422_UNPROCESSABLE_ENTITY,
        "validation_failed",
        first.get("msg", "Validation failed"),
        field=field,
        extra={
            "errors": [
                {
                    "field": ".".join(
                        str(p) for p in e.get("loc", ()) if p not in ("body", "query", "path")
                    )
                    or None,
                    "message": e.get("msg", ""),
                    "type": e.get("type", ""),
                }
                for e in errors[:20]  # a bounded body: a 500-field form is not a useful error
            ]
        },
    )


async def http_exception_handler(request: Request, exc: Exception) -> ORJSONResponse:
    """Starlette's own exceptions - 404 from the router, 405, and friends."""
    assert isinstance(exc, StarletteHTTPException)
    codes = {
        400: "bad_request",
        401: "unauthenticated",
        403: "forbidden",
        404: "not_found",
        405: "method_not_allowed",
        409: "conflict",
        413: "payload_too_large",
        415: "unsupported_media_type",
        429: "rate_limited",
    }
    code = codes.get(exc.status_code, "error")
    detail = exc.detail if isinstance(exc.detail, str) else "Request failed"
    return response(
        exc.status_code,
        code,
        detail,
        headers=dict(exc.headers) if exc.headers else None,
    )


async def unhandled_handler(request: Request, exc: Exception) -> ORJSONResponse:
    """The last resort. The client gets a request id; the log gets everything else."""
    log.error(
        "request.unhandled",
        endpoint=request.url.path,
        method=request.method,
        exc_type=type(exc).__name__,
        exc_info=True,
    )
    return response(
        status.HTTP_500_INTERNAL_SERVER_ERROR,
        "internal_error",
        "An unexpected error occurred. Quote the request id if you report this.",
    )
