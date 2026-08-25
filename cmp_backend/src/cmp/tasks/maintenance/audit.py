"""Verifying the hash chain.

Recomputes every row digest and reports the first that does not verify. Daily,
because the value of an append-only trail is entirely in being able to say it has
not been tampered with — and a claim nobody checks is a claim nobody should
believe.

The answer is deliberately positional: not "something changed" but "the trail is
sound up to exactly here". That is what makes it actionable.
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


@shared_task(name="cmp.maintenance.verify_audit_chain", acks_late=True)
def verify_audit_chain() -> dict[str, Any]:
    """Walk the audit hash chain nightly.

    Verification on demand only tells you the trail was intact when somebody
    thought to ask. Running it on a schedule means a break is discovered within a
    day of happening, while the surrounding evidence still exists.
    """

    async def work() -> dict[str, Any]:
        async with ratelimit.lock("verify_audit", ttl_s=900) as acquired:
            if not acquired:
                return {"skipped": True}

            async with transaction() as conn:
                result = await audit.verify_chain(conn)
                if not result["intact"]:
                    brk = result["first_break"]
                    log.error(
                        "audit.chain_broken",
                        log_id=brk["log_id"],
                        occurred_at=str(brk["occurred_at"]),
                        reason=brk["reason"],
                    )
                else:
                    await audit.record(
                        conn, event=Event.AUDIT_VERIFIED, entity_type="audit_log",
                        entity_id=0, actor_user_id=None,
                        detail={"rows_checked": result["rows_checked"], "intact": True},
                    )
            return {"intact": result["intact"], "rows_checked": result["rows_checked"]}

    return _run(work)
