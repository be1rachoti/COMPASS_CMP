"""Flagging assets with unmapped subjects.

The control that makes direct collection workable. The dangerous outcome is never
a rejected import — that is obvious and gets fixed. It is 500 assets declared,
480 mapped, and twenty sitting in an unlawful state nobody is looking at.

Runs every six hours: often enough that a gap is found the same working day,
rarely enough that it is not competing with collection.
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


@shared_task(name="cmp.maintenance.flag_unmapped_assets", acks_late=True)
def flag_unmapped_assets() -> dict[str, Any]:
    """Reconcile declared against mapped asset counts.

    Surfaces the 20 assets in a 500-declared/480-mapped collection that are
    sitting in an unlawful state nobody has looked at. It flags; a person
    decides.
    """

    async def work() -> dict[str, Any]:
        async with ratelimit.lock("flag_unmapped", ttl_s=300) as acquired:
            if not acquired:
                return {"skipped": True}

            from cmp.db.sql import fetch_all

            async with transaction() as conn:
                gaps = await fetch_all(
                    conn,
                    """
                    SELECT c.collection_id, c.collection_uuid, c.declared_asset_count,
                           (SELECT count(*) FROM data_asset a
                             WHERE a.collection_id = c.collection_id) AS mapped
                    FROM collection c
                    WHERE c.declared_asset_count >
                          (SELECT count(*) FROM data_asset a
                            WHERE a.collection_id = c.collection_id)
                    LIMIT 1000
                    """,
                )
                for gap in gaps:
                    await audit.record(
                        conn, event=Event.IMPORT_RECEIVED, entity_type="collection",
                        entity_id=gap["collection_id"], actor_user_id=None,
                        detail={"declared": gap["declared_asset_count"],
                                "mapped": gap["mapped"],
                                "unaccounted": gap["declared_asset_count"] - gap["mapped"],
                                "detected_by": "scheduled_reconciliation"},
                    )
            log.info("maintenance.reconciliation", collections_with_gaps=len(gaps))
            return {"collections_with_gaps": len(gaps)}

    return _run(work)
