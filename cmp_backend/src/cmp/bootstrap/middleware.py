"""Installing the middleware stack, outermost first.

Two groups, and the order between them matters more than the order within
either.

**Starlette's own, first.** Host allow-listing, CORS and compression. A request
for a host we do not serve should be refused before it reaches anything that
logs or allocates — including our own request-context middleware, which mints an
id and binds a contextvar.

**Ours, second.** `cmp.api.middleware.install` registers the four that need
application knowledge: correlation id, security headers, body limit, access log.

CORS carries credentials because the session cookie has to travel, and exposes
the handful of headers a browser client legitimately reads — without
`expose_headers` a fetch() cannot see `X-Request-ID`, which is the string a user
would otherwise be quoting in a support ticket.
"""

from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from starlette.middleware.trustedhost import TrustedHostMiddleware

from cmp.api import middleware as api_middleware
from cmp.core.config import settings
from cmp.core.constants import (
    CONTENT_HASH_HEADER,
    EXPORT_GENERATED_HEADER,
    RECORDED_HASH_HEADER,
    REQUEST_ID_HEADER,
    RESPONSE_TIME_HEADER,
)


def install(app: FastAPI) -> None:
    if settings.trusted_hosts and "*" not in settings.trusted_hosts:
        app.add_middleware(TrustedHostMiddleware, allowed_hosts=list(settings.trusted_hosts))

    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(settings.cors_origins),
        allow_credentials=True,  # the session cookie must travel
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=[
            "Content-Type",
            "Authorization",
            settings.csrf_header_name,
            REQUEST_ID_HEADER,
        ],
        expose_headers=[
            REQUEST_ID_HEADER,
            RESPONSE_TIME_HEADER,
            "Retry-After",
            "Content-Disposition",
            EXPORT_GENERATED_HEADER,
            RECORDED_HASH_HEADER,
            CONTENT_HASH_HEADER,
        ],
        max_age=600,
    )
    app.add_middleware(GZipMiddleware, minimum_size=1024)

    api_middleware.install(app)
