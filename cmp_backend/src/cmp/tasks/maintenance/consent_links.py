"""Expiring consent links.

Runs every fifteen minutes, and the cadence is the point. A link past its expiry
must stop *resolving*, not merely stop being advertised — a field agent with the
URL in their phone will keep opening it, and a link that still works an hour
after it expired is collecting consent nobody authorised.

Idempotent: expiring an already-expired link changes nothing and reports zero.
`acks_late` means this task can be redelivered, so that matters.
"""

from __future__ import annotations

import asyncio
from typing import Any

from celery import shared_task

from cmp.auth.rate_limit import service as ratelimit
from cmp.core.logging import get_logger
from cmp.db.pool import close_pool, open_pool, transaction
from cmp.db.redis import close_redis, open_redis
from cmp.domain.audit import service as audit
from cmp.domain.audit.service import Event

log = get_logger("cmp.tasks.maintenance")


def _run(coro: Any) -> Any:
    """Run one async unit of work inside a synchronous Celery task.

    A fresh loop and fresh pools per task: sharing a pool across forked workers
    hands the same socket to two processes, and the symptoms are baffling.
    """
    import sys

    if sys.platform == "win32":
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

    async def wrapper() -> Any:
        await open_pool()
        await open_redis()
        try:
            return await coro()
        finally:
            await close_redis()
            await close_pool()

    return asyncio.run(wrapper())


@shared_task(name="cmp.maintenance.expire_consent_links", acks_late=True)
def expire_consent_links() -> dict[str, Any]:
    """Mark links past their expiry.

    `resolve_link` already refuses an expired link on the read path, so this is
    housekeeping rather than enforcement - it keeps the status column honest so a
    DCO looking at a list sees the truth without re-deriving it.
    """

    async def work() -> dict[str, Any]:
        async with ratelimit.lock("expire_links", ttl_s=120) as acquired:
            if not acquired:
                log.info("maintenance.skipped", task="expire_consent_links")
                return {"skipped": True}

            from cmp.db.repositories import consent as repo

            async with transaction() as conn:
                expired = await repo.expire_due_links(conn)
                if expired:
                    await audit.record(
                        conn,
                        event=Event.LINK_REVOKED,
                        entity_type="consent_link",
                        entity_id=0,
                        actor_user_id=None,
                        detail={"expired_by_schedule": expired},
                    )
            log.info("maintenance.links_expired", count=expired)
            return {"expired": expired}

    return _run(work)
