"""Async connection pool and the unit of work.

Repositories never open a connection. They receive one, already inside the
transaction the service opened. That is what makes "publish a notice" one atomic
operation instead of four writes that can half-succeed.

Session-level `statement_timeout` and `lock_timeout` are set on every checkout.
A query with no timeout is a query that can hold a lock until the pool starves.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any, Final

import psycopg
from psycopg.rows import dict_row
from psycopg_pool import AsyncConnectionPool

from cmp.core.config import settings
from cmp.core.errors import ServiceUnavailable
from cmp.core.logging import get_logger

log = get_logger("cmp.db")

_pool: AsyncConnectionPool | None = None

_SESSION_SETUP: Final = (
    f"SET statement_timeout = {settings.db_statement_timeout_ms}; "
    f"SET lock_timeout = {settings.db_lock_timeout_ms}; "
    "SET idle_in_transaction_session_timeout = 30000; "
    "SET TIME ZONE 'UTC';"
)


async def _configure(conn: psycopg.AsyncConnection[Any]) -> None:
    conn.row_factory = dict_row
    await conn.execute(_SESSION_SETUP)
    await conn.commit()


async def _probe() -> None:
    """One direct connection before the pool opens.

    The pool retries in the background and reports `PoolTimeout`, which names the
    symptom and hides the cause - a wrong password, an unreachable host and an
    incompatible event loop all look identical. A single probe surfaces the real
    exception, once, at startup.
    """
    try:
        conn = await psycopg.AsyncConnection.connect(settings.dsn, connect_timeout=5)
        await conn.close()
    except psycopg.InterfaceError as exc:
        if "ProactorEventLoop" in str(exc):
            raise RuntimeError(
                "psycopg cannot use Windows' ProactorEventLoop. Start the API with "
                "`python -m cmp` (which sets WindowsSelectorEventLoopPolicy) rather "
                "than invoking uvicorn directly."
            ) from exc
        raise
    except psycopg.OperationalError as exc:
        raise ServiceUnavailable(
            f"Cannot reach PostgreSQL at {settings.postgres_host}:{settings.postgres_port} "
            f"as {settings.postgres_user}/{settings.postgres_db}: {exc}"
        ) from exc


async def open_pool() -> AsyncConnectionPool:
    global _pool
    if _pool is not None:
        return _pool
    await _probe()
    _pool = AsyncConnectionPool(
        conninfo=settings.dsn,
        min_size=settings.db_pool_min_size,
        max_size=settings.db_pool_max_size,
        timeout=settings.db_pool_timeout_s,
        max_lifetime=30 * 60,
        max_idle=5 * 60,
        configure=_configure,
        open=False,
        name="cmp-pg",
    )
    await _pool.open(wait=True, timeout=settings.db_pool_timeout_s)
    log.info("db.pool.open", min_size=_pool.min_size, max_size=_pool.max_size)
    return _pool


async def close_pool() -> None:
    global _pool
    if _pool is not None:
        await _pool.close()
        log.info("db.pool.closed")
        _pool = None


def get_pool() -> AsyncConnectionPool:
    if _pool is None:  # pragma: no cover - programming error, not a runtime path
        raise RuntimeError("Connection pool is not open. Call open_pool() in the lifespan.")
    return _pool


@asynccontextmanager
async def connection() -> AsyncIterator[psycopg.AsyncConnection[Any]]:
    """A read connection. Autocommit - no transaction is held open for a SELECT."""
    try:
        async with get_pool().connection() as conn:
            await conn.set_autocommit(True)
            yield conn
    except psycopg.OperationalError as exc:
        log.error("db.unavailable", error=str(exc))
        raise ServiceUnavailable("Database is unavailable") from exc


@asynccontextmanager
async def transaction() -> AsyncIterator[psycopg.AsyncConnection[Any]]:
    """A write unit of work. Commits on clean exit, rolls back on any exception.

    Keep the body short: a transaction that awaits an HTTP call holds a row lock
    for the duration of somebody else's outage.
    """
    try:
        async with get_pool().connection() as conn:
            await conn.set_autocommit(False)
            try:
                async with conn.transaction():
                    yield conn
            finally:
                await conn.set_autocommit(True)
    except psycopg.OperationalError as exc:
        log.error("db.unavailable", error=str(exc))
        raise ServiceUnavailable("Database is unavailable") from exc


async def healthcheck() -> bool:
    """Readiness: can we reach the database at all?"""
    try:
        async with connection() as conn:
            cur = await conn.execute("SELECT 1 AS ok")
            row = await cur.fetchone()
            return bool(row and row["ok"] == 1)
    except Exception:
        return False


async def schema_version() -> str | None:
    """Readiness also asks whether migrations are current."""
    try:
        async with connection() as conn:
            cur = await conn.execute("SELECT version_num FROM alembic_version LIMIT 1")
            row = await cur.fetchone()
            return str(row["version_num"]) if row else None
    except Exception:
        return None
