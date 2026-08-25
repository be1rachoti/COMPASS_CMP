"""Is this deployment actually working?

Not the same question as `/health`, which says the process is up, or `/ready`,
which says its dependencies answer. This checks the things that are *configured
correctly but silently wrong* — the failures that do not show up until somebody
needs the system to have been working all along.

Run it after a deploy, and on a schedule if you want the audit chain checked
outside Celery.

    uv run python scripts/healthcheck.py
    uv run python scripts/healthcheck.py --json

Exit code is 0 if everything passed, 1 if anything failed. Safe to run against
production: it reads, and writes nothing.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from dataclasses import asdict, dataclass
from typing import Any

sys.path.insert(0, "src")


@dataclass
class Check:
    name: str
    ok: bool
    detail: str = ""

    @property
    def line(self) -> str:
        return f"  {'PASS' if self.ok else 'FAIL'}  {self.name}" + (
            f"  — {self.detail}" if self.detail else ""
        )


async def run_checks() -> list[Check]:
    from cmp.core.config import settings
    from cmp.db.pool import close_pool, connection, open_pool, schema_version
    from cmp.db.redis import close_redis, get_redis, open_redis

    results: list[Check] = []

    await open_pool()
    await open_redis()
    try:
        # ---------------------------------------------------------- reachable
        async with connection() as conn:
            cur = await conn.execute("SELECT 1 AS ok")
            results.append(Check("postgres reachable", (await cur.fetchone())["ok"] == 1))

        await get_redis().ping()
        results.append(Check("redis reachable", True))

        # ------------------------------------------------------------ schema
        version = await schema_version()
        results.append(
            Check(
                "schema is migrated",
                version is not None,
                version or "no alembic_version row — run: alembic upgrade head",
            )
        )

        async with connection() as conn:
            # The enforcement layer. A deployment whose triggers were dropped by
            # a restore looks completely healthy until somebody edits history.
            cur = await conn.execute(
                "SELECT count(*) AS n FROM pg_trigger WHERE NOT tgisinternal"
            )
            triggers = (await cur.fetchone())["n"]
            results.append(
                Check("enforcement triggers present", triggers >= 20, f"{triggers} triggers")
            )

            # Migration 0003 revokes UPDATE/DELETE from the application role.
            # It has no effect if the application connects as the table *owner*,
            # because an owner's privileges are implicit and survive a REVOKE.
            # That is a deployment mistake rather than a migration failure, and
            # the message says which — a check that reports the wrong cause sends
            # somebody to re-run a migration that already worked.
            cur = await conn.execute(
                """SELECT
                     (SELECT tableowner FROM pg_tables WHERE tablename = 'audit_log')
                       = current_user                                    AS is_owner,
                     (SELECT count(*) FROM information_schema.table_privileges
                       WHERE grantee = current_user
                         AND table_name = 'audit_log'
                         AND privilege_type IN ('UPDATE', 'DELETE'))     AS granted"""
            )
            row = await cur.fetchone()
            results.append(
                Check(
                    "audit_log is not writable by the app role",
                    not row["is_owner"] and row["granted"] == 0,
                    "the application connects as the table owner, so migration "
                    "0003's REVOKE does not apply — use a separate least-privilege "
                    "role in production (the append-only trigger still refuses the "
                    "statement, so the record is safe either way)"
                    if row["is_owner"]
                    else "UPDATE/DELETE granted — migration 0003 has not been applied"
                    if row["granted"]
                    else "",
                )
            )

            # The layer that holds regardless of who is connected. Asserted by
            # attempting the write, because a trigger that exists and is disabled
            # looks identical to one that works.
            try:
                async with conn.transaction(force_rollback=True):
                    await conn.execute(
                        "UPDATE audit_log SET event_type = event_type "
                        "WHERE log_id = (SELECT min(log_id) FROM audit_log)"
                    )
                results.append(
                    Check("append-only trigger refuses UPDATE", False, "the UPDATE succeeded")
                )
            except Exception as exc:  # the refusal IS the pass, so catch broadly
                results.append(
                    Check(
                        "append-only trigger refuses UPDATE",
                        "append-only" in str(exc),
                        str(exc).splitlines()[0][:80],
                    )
                )

            # ------------------------------------------------------ the chain
            from cmp.domain.audit.service import verify_chain

            chain = await verify_chain(conn, from_log_id=0)
            results.append(
                Check(
                    "audit chain verifies",
                    bool(chain["intact"]),
                    f"{chain['rows_checked']} rows"
                    if chain["intact"]
                    else f"first break at log {chain['first_break']['log_id']}",
                )
            )

            # ---------------------------------------------- data-level health
            # Collections whose declared count exceeds what was mapped. Not an
            # outage, but it is people in an unlawful state, and nothing else
            # surfaces it outside the console.
            cur = await conn.execute(
                """SELECT count(*) AS n FROM collection c
                   WHERE c.declared_asset_count >
                         (SELECT count(*) FROM data_asset a
                           WHERE a.collection_id = c.collection_id)"""
            )
            unreconciled = (await cur.fetchone())["n"]
            results.append(
                Check(
                    "every collection reconciles",
                    unreconciled == 0,
                    f"{unreconciled} collection(s) declared more than was mapped",
                )
            )

            cur = await conn.execute(
                "SELECT count(*) AS n FROM data_asset WHERE has_unmapped_subjects"
            )
            flagged = (await cur.fetchone())["n"]
            results.append(
                Check(
                    "no asset carries an unmapped subject",
                    flagged == 0,
                    f"{flagged} asset(s) contain somebody with no consent behind them",
                )
            )

        # ------------------------------------------------------ configuration
        results.append(
            Check(
                "cookies are secure",
                settings.cookie_secure or not settings.is_production,
                "COOKIE_SECURE is false" if not settings.cookie_secure else "",
            )
        )
        results.append(
            Check(
                "transports are configured for this environment",
                not settings.is_production or settings.email_transport != "console",
                f"email_transport={settings.email_transport} — production is writing "
                "mail to a file"
                if settings.is_production and settings.email_transport == "console"
                else f"email={settings.email_transport}, storage={settings.storage_backend}",
            )
        )

    finally:
        await close_redis()
        await close_pool()

    return results


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--json", action="store_true", help="machine-readable output")
    args = parser.parse_args()

    if sys.platform == "win32":
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

    checks = asyncio.run(run_checks())
    failed = [c for c in checks if not c.ok]

    if args.json:
        payload: dict[str, Any] = {
            "ok": not failed,
            "checks": [asdict(c) for c in checks],
        }
        sys.stdout.write(json.dumps(payload, indent=2) + "\n")
    else:
        for check in checks:
            sys.stdout.write(check.line + "\n")
        sys.stdout.write(
            f"\n{len(checks) - len(failed)}/{len(checks)} passed\n"
        )

    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
