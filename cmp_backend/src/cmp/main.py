"""Application factory.

Resources are opened in the lifespan and closed on the way out, in reverse order.
Opening a connection pool at import time makes the module unimportable without a
database, which breaks tests, `--help`, and every tool that reflects on the app.

Startup is fail-fast: if the database or Redis is unreachable, the process exits
rather than serving a stream of 503s that look like an application bug. An
orchestrator can restart a dead process; it cannot diagnose a live one that is
quietly broken.
"""

from __future__ import annotations

import asyncio
import sys
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import ORJSONResponse
from starlette.middleware.trustedhost import TrustedHostMiddleware

from cmp.api import errors as api_errors
from cmp.api import middleware as api_middleware
from cmp.api.routers import ROUTERS
from cmp.core.config import settings
from cmp.core.logging import configure_logging, get_logger
from cmp.db.pool import close_pool, open_pool
from cmp.db.redis import close_redis, open_redis

log = get_logger("cmp.main")

DESCRIPTION = """
Consent Management Platform.

Conventions that apply to every endpoint:

* **Identifiers are uuids.** Integer primary keys never appear in a URL, a
  response body, an export or a log. The one exception is `/c/{token}`, which
  carries a capability rather than a reference.
* **Lists are cursor-paginated.** `?limit=&cursor=&sort=`. Offset pagination
  skips or repeats rows when the underlying set changes between pages.
* **Unknown filters are rejected**, never ignored.
* **403 means visible but not permitted.** Anything outside your scope is 404 -
  a 403 would confirm it exists.
"""


def _configure_event_loop() -> None:
    """psycopg's async mode cannot run on Windows' ProactorEventLoop.

    Without this, the API runs on Linux and CI but not on a Windows developer
    machine - and "works on the server" is a poor answer to someone trying to
    reproduce a bug locally.
    """
    if sys.platform == "win32":
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    configure_logging()
    log.info(
        "startup.begin",
        environment=settings.environment,
        version=settings.version,
        debug=settings.debug,
    )

    await open_pool()
    await open_redis()

    from cmp.db.pool import schema_version

    version = await schema_version()
    if version is None:
        log.warning("startup.no_schema_version", hint="run: alembic upgrade head")
    app.state.schema_version = version

    log.info("startup.ready", schema_version=version)
    try:
        yield
    finally:
        # Reverse order, and both attempted even if the first raises: a failed
        # Redis close must not leak database connections.
        log.info("shutdown.begin")
        try:
            await close_redis()
        finally:
            await close_pool()
        log.info("shutdown.complete")


def create_app() -> FastAPI:
    _configure_event_loop()
    configure_logging()

    app = FastAPI(
        title="Consent Management Platform",
        description=DESCRIPTION,
        version=settings.version,
        lifespan=lifespan,
        default_response_class=ORJSONResponse,
        root_path=settings.root_path,
        # The interactive docs are a development affordance, not a production
        # surface. They enumerate every route and schema for an unauthenticated
        # reader.
        docs_url=None if settings.is_production else "/docs",
        redoc_url=None if settings.is_production else "/redoc",
        openapi_url=None if settings.is_production else "/openapi.json",
        swagger_ui_parameters={"persistAuthorization": True},
        contact={"name": "Privacy Office", "email": settings.notification_email_from},
    )

    # Host allow-list first: a request for a host we do not serve should not
    # reach anything that logs or allocates.
    if settings.trusted_hosts and "*" not in settings.trusted_hosts:
        app.add_middleware(TrustedHostMiddleware, allowed_hosts=list(settings.trusted_hosts))

    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(settings.cors_origins),
        allow_credentials=True,   # the session cookie must travel
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Content-Type", "Authorization", settings.csrf_header_name,
                       "X-Request-ID"],
        expose_headers=["X-Request-ID", "X-Response-Time-ms", "Retry-After",
                        "Content-Disposition", "X-Export-Generated-At"],
        max_age=600,
    )
    app.add_middleware(GZipMiddleware, minimum_size=1024)

    api_middleware.install(app)
    api_errors.install(app)

    for router in ROUTERS:
        app.include_router(router)

    _install_metrics(app)
    return app


def _install_metrics(app: FastAPI) -> None:
    """Prometheus metrics, if the dependency is present.

    Optional on purpose: a metrics exporter that fails to import must not stop
    the API from serving.
    """
    try:
        from prometheus_fastapi_instrumentator import Instrumentator
    except ImportError:  # pragma: no cover
        log.warning("metrics.unavailable")
        return

    Instrumentator(
        should_group_status_codes=False,
        should_ignore_untemplated=True,      # never emit a series per consent token
        excluded_handlers=["/metrics", "/health", "/ready"],
    ).instrument(app).expose(app, endpoint="/metrics", include_in_schema=False)


app = create_app()
