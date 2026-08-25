"""Acting on retention periods that have run out.

The quiet obligation. A purpose declares how long data may be kept for it; when
that runs out, keeping the data is no longer lawful, and nobody is going to
notice by hand across thousands of records.

Runs at 02:00 rather than continuously because it can touch a lot of rows, and a
retention sweep competing with a collection campaign for the same tables helps
nobody. Quarantine is the default lapse behaviour rather than erase: data that is
unreachable can be restored if the lapse was a mistake, and data that is gone
cannot.
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


@shared_task(name="cmp.maintenance.apply_retention_lapse", acks_late=True)
def apply_retention_lapse() -> dict[str, Any]:
    """Act on `purpose.lapse_behaviour` where a consent's validity has elapsed.

    `quarantine` marks the asset rows rather than deleting anything. Deletion is
    irreversible and a scheduled job is the wrong place to make an irreversible
    decision unattended - `erase` is therefore recorded as due and left for a
    reviewed run.
    """

    async def work() -> dict[str, Any]:
        async with ratelimit.lock("retention_lapse", ttl_s=900) as acquired:
            if not acquired:
                log.info("maintenance.skipped", task="apply_retention_lapse")
                return {"skipped": True}

            from cmp.db.sql import fetch_all

            async with transaction() as conn:
                lapsed = await fetch_all(
                    conn,
                    """
                    SELECT DISTINCT ac.asset_consent_id, ac.asset_id, ac.consent_id,
                           p.lapse_behaviour, p.purpose_code
                    FROM v_current_consent vc
                    JOIN consent_purpose_grant g ON g.consent_id = vc.consent_id
                    JOIN purpose p ON p.purpose_id = g.purpose_id
                    JOIN asset_consent ac ON ac.consent_id = vc.consent_id
                    WHERE g.granted
                      AND p.consent_validity_period IS NOT NULL
                      AND vc.affirmative_action_at + p.consent_validity_period < now()
                      AND ac.disposition = 'active'
                      AND p.lapse_behaviour <> 'none'
                    LIMIT 5000
                    """,
                )

                quarantined, erase_due = 0, 0
                for row in lapsed:
                    if row["lapse_behaviour"] == "quarantine":
                        await conn.execute(
                            """UPDATE asset_consent
                                  SET disposition = 'quarantined', disposition_at = now()
                                WHERE asset_consent_id = %s AND disposition = 'active'""",
                            (row["asset_consent_id"],),
                        )
                        quarantined += 1
                    else:
                        erase_due += 1

                if quarantined or erase_due:
                    await audit.record(
                        conn,
                        event=Event.ASSET_DISPOSITION_CHANGED,
                        entity_type="asset_consent",
                        entity_id=0,
                        actor_user_id=None,
                        detail={
                            "quarantined": quarantined,
                            "erase_due": erase_due,
                            "reason": "consent_validity_elapsed",
                        },
                    )

            log.info("maintenance.retention_applied", quarantined=quarantined, erase_due=erase_due)
            return {"quarantined": quarantined, "erase_due": erase_due}

    return _run(work)
