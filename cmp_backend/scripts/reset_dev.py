"""Drop and rebuild the development database.

For when a migration went sideways or the local data has drifted somewhere
unhelpful. Drops the public schema, re-runs every migration, and seeds.

    uv run python scripts/reset_dev.py
    uv run python scripts/reset_dev.py --no-seed

**Refuses to run outside local and test**, and asks for confirmation even there.
Both guards are deliberate: this is the most destructive thing in the repository,
and the environment variable that would make it safe is the same one somebody
copies into a staging shell at the end of a long day.

There is no `--force`. If you need to bypass the prompt in CI, drop the database
with your own psql — making destruction convenient is how it happens by accident.

The three phases are separate functions, and only the middle one is async. The
confirmation and the subprocesses are synchronous work; running them inside an
async function blocks the loop and, more to the point, makes the destructive step
harder to read than it should be.
"""

from __future__ import annotations

import argparse
import asyncio
import subprocess
import sys

sys.path.insert(0, "src")


def confirm() -> bool:
    """Both guards, before anything is opened or dropped."""
    from cmp.core.config import settings

    if settings.environment not in ("local", "test"):
        sys.stderr.write(
            f"Refusing to run: ENVIRONMENT is {settings.environment!r}.\n"
            "This script drops the schema. It runs in local and test only.\n"
        )
        return False

    sys.stdout.write(
        f"This will DROP every table in {settings.postgres_db} on "
        f"{settings.postgres_host}:{settings.postgres_port} and rebuild it.\n"
    )
    if input("Type the database name to confirm: ").strip() != settings.postgres_db:
        sys.stdout.write("Nothing was changed.\n")
        return False

    return True


async def drop_schema() -> None:
    """The destructive step, and only that."""
    from cmp.db.pool import close_pool, open_pool, transaction

    await open_pool()
    try:
        async with transaction() as conn:
            # CASCADE takes the enums, the view and the functions with it. A
            # DROP TABLE loop would leave 25 orphaned types behind, and the next
            # migration would fail on "type already exists" — which reads as a
            # migration bug rather than an incomplete reset.
            await conn.execute("DROP SCHEMA public CASCADE")
            await conn.execute("CREATE SCHEMA public")
        sys.stdout.write("Schema dropped.\n")
    finally:
        await close_pool()


def rebuild(*, seed: bool) -> int:
    """Migrate, then seed.

    Subprocesses rather than in-process calls, so Alembic gets a clean
    interpreter with its own event loop — its runner is synchronous, and mixing
    it into a loop this script already started is a category of problem nobody
    should have to debug during a reset.
    """
    # Fixed argv, no shell, nothing taken from user input.
    migrate = subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", "head"],
        check=False,
    )
    if migrate.returncode != 0:
        sys.stderr.write("Migrations failed. The database is empty.\n")
        return migrate.returncode
    sys.stdout.write("Migrations applied.\n")

    if seed:
        seeded = subprocess.run(
            [sys.executable, "scripts/seed.py"],
            check=False,
        )
        if seeded.returncode != 0:
            sys.stderr.write("Seeding failed. The schema is present but empty.\n")
            return seeded.returncode
        sys.stdout.write("Seeded.\n")

    sys.stdout.write("\nDone.\n")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Drop and rebuild the dev database.")
    parser.add_argument(
        "--no-seed", action="store_true", help="migrate but do not load development data"
    )
    args = parser.parse_args()

    if sys.platform == "win32":
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

    if not confirm():
        return 1

    asyncio.run(drop_schema())
    return rebuild(seed=not args.no_seed)


if __name__ == "__main__":
    raise SystemExit(main())
