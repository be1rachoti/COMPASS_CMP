"""Scheduled work.

Every task here is idempotent and holds a lock, because Celery gives at-least-once
delivery and Beat can be restarted mid-schedule. A retention sweep that runs twice
must be indistinguishable from one that ran once.

The lock is a guard against concurrency, not a correctness boundary - its TTL can
expire while the holder is still working. Correctness comes from the SQL: every
statement below matches only rows that still need the change, so a second run
matches nothing.
"""

from __future__ import annotations

import asyncio
from typing import Any

from celery import shared_task

from cmp.auth.rate_limit import service as ratelimit
from cmp.core.logging import get_logger
from cmp.db.pool import close_pool, open_pool, transaction
from cmp.db.redis import close_redis, open_redis
from cmp.domain import audit
from cmp.domain.audit import Event

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
                        conn, event=Event.LINK_REVOKED, entity_type="consent_link",
                        entity_id=0, actor_user_id=None,
                        detail={"expired_by_schedule": expired},
                    )
            log.info("maintenance.links_expired", count=expired)
            return {"expired": expired}

    return _run(work)


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
                        conn, event=Event.ASSET_DISPOSITION_CHANGED,
                        entity_type="asset_consent", entity_id=0, actor_user_id=None,
                        detail={"quarantined": quarantined, "erase_due": erase_due,
                                "reason": "consent_validity_elapsed"},
                    )

            log.info("maintenance.retention_applied",
                     quarantined=quarantined, erase_due=erase_due)
            return {"quarantined": quarantined, "erase_due": erase_due}

    return _run(work)


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
