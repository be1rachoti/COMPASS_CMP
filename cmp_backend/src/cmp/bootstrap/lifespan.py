"""Opening and closing the things the process needs.

Resources open in the lifespan and close in reverse on the way out. Not at
import: a module that opens a connection pool when imported is a module that
cannot be imported without a database, which breaks the test suite, `--help`,
and every tool that reflects on the app to generate a schema.

Startup is **fail-fast**. If PostgreSQL or Redis is unreachable the process
exits rather than serving a stream of 503s that look like an application bug.
An orchestrator can restart a dead process; it cannot diagnose a live one that
is quietly broken.

Shutdown attempts both closes even if the first raises, because a failed Redis
close must not leak database connections.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI

from cmp.core.config import settings
from cmp.core.logging import configure_logging, get_logger
from cmp.db.pool import close_pool, open_pool, schema_version
from cmp.db.redis import close_redis, open_redis

log = get_logger("cmp.bootstrap.lifespan")


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

    # Recorded on app state so /ready can report it. A process serving against a
    # schema older than the code is a specific, diagnosable failure — and a much
    # better error than the column-not-found it would otherwise produce.
    version = await schema_version()
    if version is None:
        log.warning("startup.no_schema_version", hint="run: alembic upgrade head")
    app.state.schema_version = version

    log.info("startup.ready", schema_version=version)
    try:
        yield
    finally:
        log.info("shutdown.begin")
        try:
            await close_redis()
        finally:
            await close_pool()
        log.info("shutdown.complete")
