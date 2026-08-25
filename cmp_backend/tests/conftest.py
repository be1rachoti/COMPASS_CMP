"""Shared fixtures.

Two tiers of test, and the split is deliberate:

* **Unit** - pure functions. No database, no Redis, no event loop juggling. These
  run in milliseconds and are where the transition table, the permission matrix
  and the crypto primitives are pinned down.

* **Integration** (`-m integration`) - the real PostgreSQL and the real Redis.
  Marked, so `pytest -m "not integration"` still works on a machine with neither.
  They are not optional in CI: the constraints in migration 0002 are enforcement,
  and enforcement that is only tested against a mock is enforcement nobody has
  tested. The empty-array CHECK bug in 0004 was found this way and could not have
  been found any other way.

Each integration test runs inside a transaction that is rolled back afterwards,
so tests neither see nor leave each other's rows.
"""

from __future__ import annotations

import asyncio
import os
import sys
from collections.abc import AsyncIterator
from typing import Any

import pytest

# psycopg's async mode cannot run on Windows' ProactorEventLoop. Set before any
# loop is created, or every integration test fails with a misleading timeout.
if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

os.environ.setdefault("ENVIRONMENT", "test")
os.environ.setdefault("SECRET_KEY", "test-secret-key-at-least-32-bytes-long!!")
os.environ.setdefault("COOKIE_SECURE", "false")


@pytest.fixture(scope="session")
def anyio_backend() -> str:
    return "asyncio"


# --------------------------------------------------------------- integration
@pytest.fixture(scope="session")
async def db_pool() -> AsyncIterator[Any]:
    """One pool for the whole session. Opening one per test is most of the runtime."""
    from cmp.db.pool import close_pool, open_pool

    pool = await open_pool()
    yield pool
    await close_pool()


@pytest.fixture(scope="session")
async def redis_client() -> AsyncIterator[Any]:
    from cmp.db.redis import close_redis, open_redis

    client = await open_redis()
    yield client
    await close_redis()


@pytest.fixture
async def redis_conn() -> AsyncIterator[Any]:
    """A Redis connection opened and closed within this test's event loop.

    Function-scoped, unlike `redis_client`, and that is not a preference. Under
    `asyncio_mode = "auto"` pytest-asyncio gives each test its own event loop; a
    redis-py connection is bound to the loop it was created on, so a
    session-scoped client is unusable from the second test onwards and closes
    against a loop that has already gone — surfacing as "Event loop is closed"
    from a teardown far from the cause.

    The connection pool tolerates this because psycopg opens its connections
    lazily per use. Redis does not, so anything touching it gets this instead.

    Keys are namespaced by the test's own identifiers rather than flushed: a
    FLUSHDB here would wipe the sessions of anybody running the app against the
    same Redis, which on a developer machine is exactly what is happening.
    """
    from cmp.db.redis import close_redis, open_redis

    client = await open_redis()
    try:
        yield client
    finally:
        await close_redis()


@pytest.fixture
async def conn(db_pool: Any) -> AsyncIterator[Any]:
    """A connection whose transaction is always rolled back.

    Every test therefore starts from the same state, and a test that writes a
    consent artefact does not leave one behind for the next test's count to trip
    over.
    """
    async with db_pool.connection() as connection:
        await connection.set_autocommit(False)
        transaction = connection.transaction(force_rollback=True)
        await transaction.__aenter__()
        try:
            yield connection
        finally:
            await transaction.__aexit__(None, None, None)


@pytest.fixture
def request_context() -> Any:
    """A request context, so `audit.record` has an actor to attribute writes to."""
    from cmp.core.context import RequestContext, use_context

    with use_context(RequestContext(request_id="test", ip_address="127.0.0.1")) as ctx:
        yield ctx


@pytest.fixture
async def seeded(conn: Any, request_context: Any) -> dict[str, Any]:
    """A minimal coherent world inside the test transaction.

    Deliberately built with plain SQL rather than the service layer: a fixture
    that goes through the services under test would make a service bug look like
    a fixture failure.
    """
    from cmp.core.security import content_hash, hash_password
    from cmp.db.sql import fetch_one

    ids: dict[str, Any] = {}

    for role, email in [
        ("dpo", "dpo@test.local"),
        ("dco", "dco@test.local"),
        ("rnd_user", "rnd@test.local"),
        ("admin", "admin@test.local"),
    ]:
        row = await fetch_one(
            conn,
            """INSERT INTO auth_user (full_name, email, role, status, password_hash)
               VALUES (%s, %s, %s::user_role, 'active', %s)
               RETURNING id, uuid""",
            (f"Test {role}", email, role, hash_password("TestPassw0rd!123")),
        )
        ids[role] = row

    purpose = await fetch_one(
        conn,
        """INSERT INTO purpose (purpose_code, name, description, uses, lawful_basis,
                                data_categories, retention_period, retention_basis,
                                erasure_trigger, status, created_by)
           VALUES ('P-TEST', 'Test purpose', 'd', 'u', 'consent_s6', ARRAY['name'],
                   interval '1 year', 'business_policy', 'withdrawal', 'active', %s)
           RETURNING purpose_id, purpose_uuid""",
        (ids["dpo"]["id"],),
    )

    project = await fetch_one(
        conn,
        """INSERT INTO project (project_name, description, created_by, dco_user_id,
                                project_status)
           VALUES ('Test Project', 'A test project', %s, %s, 'approved')
           RETURNING project_id, project_uuid""",
        (ids["rnd_user"]["id"], ids["dco"]["id"]),
    )

    site = await fetch_one(
        conn,
        """INSERT INTO project_site (project_id, site_label, location)
           VALUES (%s, 'Test Site', 'Pune') RETURNING site_id, site_uuid""",
        (project["project_id"],),
    )

    # Created as a draft: the freeze triggers refuse purposes and languages on a
    # published notice, which is exactly the behaviour under test. Publish last.
    notice = await fetch_one(
        conn,
        """INSERT INTO notice (notice_code, project_id, version, withdraw_url,
                               exercise_rights_url, board_complaint_url, dpo_contact)
           VALUES ('N-TEST', %s, 1, 'https://x/w', 'https://x/r', 'https://dpb.gov.in',
                   'dpo@test.local')
           RETURNING notice_id, notice_uuid""",
        (project["project_id"],),
    )

    text = "The notice text under test."
    language = await fetch_one(
        conn,
        """INSERT INTO notice_language (notice_id, language_code, rendered_text,
                                        content_hash, created_by, approved_by, approved_at)
           VALUES (%s, 'english', %s, %s, %s, %s, now())
           RETURNING notice_language_id, content_hash""",
        (notice["notice_id"], text, content_hash(text), ids["dpo"]["id"], ids["dpo"]["id"]),
    )

    await conn.execute(
        "INSERT INTO notice_purpose (notice_id, purpose_id) VALUES (%s, %s)",
        (notice["notice_id"], purpose["purpose_id"]),
    )

    # Publish only now that the notice is complete.
    await conn.execute(
        """UPDATE notice SET status = 'published', recipients_text = 'Test Site',
                  approved_by = %s, published_at = now()
            WHERE notice_id = %s""",
        (ids["dpo"]["id"], notice["notice_id"]),
    )

    link = await fetch_one(
        conn,
        """INSERT INTO consent_link (notice_id, site_id, token, expires_at, created_by)
           VALUES (%s, %s, 'test-token-0000000000000000000000', now() + interval '7 days', %s)
           RETURNING link_id, link_uuid""",
        (notice["notice_id"], site["site_id"], ids["dco"]["id"]),
    )

    subject = await fetch_one(
        conn,
        """INSERT INTO auth_user (full_name, email, role, status, registered_via_link_id)
           VALUES ('Test Subject', 'subject@test.local', 'data_subject', 'active', %s)
           RETURNING id, uuid""",
        (link["link_id"],),
    )

    return {
        "users": ids,
        "subject": subject,
        "purpose": purpose,
        "project": project,
        "site": site,
        "notice": notice,
        "language": language,
        "link": link,
        "notice_text": text,
    }


def pytest_collection_modifyitems(config: Any, items: list[Any]) -> None:
    """Anything under tests/integration is integration-marked automatically.

    Relying on each author to remember the marker is how a suite ends up
    requiring a database on a laptop that does not have one.
    """
    for item in items:
        if "integration" in str(item.fspath):
            item.add_marker(pytest.mark.integration)
