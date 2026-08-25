"""The application factory.

`create_app()` and nothing else. Assembly is split across this package so each
step can be read on its own and changed without touching the others:

    lifespan     what opens at startup and closes at shutdown
    middleware   the stack, outermost first
    routers      what is mounted where
    container    which swappable adapters this environment is using

A factory rather than a module-level app: tests build their own instance,
`--help` does not need a database, and nothing is constructed as a side effect
of an import.
"""

from __future__ import annotations

from fastapi import FastAPI
from fastapi.responses import ORJSONResponse

from cmp.api import errors as api_errors
from cmp.bootstrap import container
from cmp.bootstrap import middleware as bootstrap_middleware
from cmp.bootstrap import routers as bootstrap_routers
from cmp.bootstrap.lifespan import lifespan
from cmp.core.config import settings
from cmp.core.logging import configure_logging, get_logger

log = get_logger("cmp.bootstrap")

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


def create_app() -> FastAPI:
    configure_logging()

    app = FastAPI(
        title="Consent Management Platform",
        description=DESCRIPTION,
        version=settings.version,
        lifespan=lifespan,
        default_response_class=ORJSONResponse,
        root_path=settings.root_path,
        # The interactive docs are a development affordance, not a production
        # surface: they enumerate every route and schema for an unauthenticated
        # reader.
        docs_url=None if settings.is_production else "/docs",
        redoc_url=None if settings.is_production else "/redoc",
        openapi_url=None if settings.is_production else "/openapi.json",
        swagger_ui_parameters={"persistAuthorization": True},
        contact={"name": "Privacy Office", "email": settings.notification_email_from},
    )

    bootstrap_middleware.install(app)
    api_errors.install(app)
    bootstrap_routers.install(app)
    container.warm()
    _install_metrics(app)

    return app


def _install_metrics(app: FastAPI) -> None:
    """Prometheus metrics, if the dependency is present.

    Optional on purpose: an exporter that fails to import must not stop the API
    from serving. `should_ignore_untemplated` is what keeps a consent token out
    of a metric label — an unbounded label set is both a memory leak and, here,
    a credential in a scrape endpoint.
    """
    try:
        from prometheus_fastapi_instrumentator import Instrumentator
    except ImportError:  # pragma: no cover
        log.warning("metrics.unavailable")
        return

    Instrumentator(
        should_group_status_codes=False,
        should_ignore_untemplated=True,
        excluded_handlers=["/metrics", "/health", "/ready"],
    ).instrument(app).expose(app, endpoint="/metrics", include_in_schema=False)
