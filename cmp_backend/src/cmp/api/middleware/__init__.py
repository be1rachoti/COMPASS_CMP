"""Middleware — the outermost layer of the request pipeline.

One module per concern, and the order they are installed in is the contract.

Starlette runs middleware in **reverse registration order** on the way in, so
the last one added is the first one entered. `install()` reads bottom-up for
inbound order:

    request context  ->  security headers  ->  body limit  ->  access log

Two placements in that list are load-bearing rather than arbitrary:

* **Request context is first.** Everything after it — including the failure of
  anything after it — needs somewhere to record which request it was. A 500 with
  no correlation id is a 500 nobody can match to the report that produced it.
* **Body limit is above the routes.** An oversized payload is refused before a
  Pydantic model or a file handler ever sees it. Parsing two gigabytes to
  discover it is too large is the attack this exists to stop.

Host allow-listing, CORS and compression are Starlette's own and are installed
by `bootstrap.middleware` ahead of these, because a request for a host we do not
serve should not reach anything that logs or allocates.
"""

from __future__ import annotations

from fastapi import FastAPI

from cmp.api.middleware.access_log import AccessLogMiddleware
from cmp.api.middleware.body_limit import BodyLimitMiddleware
from cmp.api.middleware.request_context import (
    SENSITIVE_PATH_PREFIXES,
    RequestContextMiddleware,
    clean_request_id,
    client_ip,
    safe_path,
)
from cmp.api.middleware.security_headers import SecurityHeadersMiddleware

__all__ = [
    "SENSITIVE_PATH_PREFIXES",
    "AccessLogMiddleware",
    "BodyLimitMiddleware",
    "RequestContextMiddleware",
    "SecurityHeadersMiddleware",
    "clean_request_id",
    "client_ip",
    "install",
    "safe_path",
]


def install(app: FastAPI) -> None:
    """Register the stack.

    Registered outermost-last, so read this bottom-up for the order a request
    actually passes through them.
    """
    app.add_middleware(AccessLogMiddleware)
    app.add_middleware(BodyLimitMiddleware)
    app.add_middleware(SecurityHeadersMiddleware)
    app.add_middleware(RequestContextMiddleware)
