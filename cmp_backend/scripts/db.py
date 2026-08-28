"""Look at the database without hunting for the password.

The connection string lives in `.env`, `psql.exe` is not on PATH on Windows, and
between them that is enough friction that people end up reading table contents
through the API — which is the one path that filters rows by role, so it is the
one path that cannot answer "what is actually in there".

    uv run python scripts/db.py                       # tables, with row counts
    uv run python scripts/db.py project               # describe a table
    uv run python scripts/db.py project --rows        # its 20 most recent rows
    uv run python scripts/db.py "SELECT ..."          # any query
    uv run python scripts/db.py --psql                # hand off to an interactive psql

Read-only by construction: every statement runs inside a transaction that is
rolled back, so a mistyped UPDATE in the query form changes nothing. That is a
convenience, not a security control - anyone who can run this can also connect
with psql directly.
"""

from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

import psycopg
from psycopg.rows import dict_row

from cmp.core.config import settings

#: Where the Windows installer puts psql. Looked up only when PATH has no psql,
#: which on a developer's Windows box is the normal case.
WINDOWS_PSQL = [
    r"C:\Program Files\PostgreSQL\17\bin\psql.exe",
    r"C:\Program Files\PostgreSQL\16\bin\psql.exe",
    r"C:\Program Files\PostgreSQL\15\bin\psql.exe",
]


def find_psql() -> str | None:
    found = shutil.which("psql")
    if found:
        return found
    return next((p for p in WINDOWS_PSQL if Path(p).exists()), None)


def show(rows: list[dict[str, Any]], *, limit_width: int = 60) -> None:
    """Print rows as a table. Plain text, because this is read in a terminal."""
    if not rows:
        print("(no rows)")
        return

    columns = list(rows[0])
    widths = {
        c: min(
            limit_width,
            max(len(c), *(len(_render(r[c], limit_width)) for r in rows)),
        )
        for c in columns
    }

    print(" | ".join(c.ljust(widths[c]) for c in columns))
    print("-+-".join("-" * widths[c] for c in columns))
    for row in rows:
        print(" | ".join(_render(row[c], limit_width).ljust(widths[c]) for c in columns))
    print(f"\n({len(rows)} rows)")


def _render(value: Any, width: int) -> str:
    if value is None:
        return "NULL"
    text = str(value).replace("\n", " ")
    return text if len(text) <= width else text[: width - 1] + "…"


def list_tables(conn: psycopg.Connection) -> None:
    """Every table with its row count.

    The counts are what make this worth running - a schema listing is available
    from `\\dt`, but "which of these actually has anything in it" is the question
    somebody opening the database is usually asking.
    """
    tables = [
        r["tablename"]
        for r in conn.execute(
            "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename"
        ).fetchall()
    ]
    rows = []
    for name in tables:
        # Interpolated because a table name cannot be a bind parameter. The
        # name came from pg_tables a moment ago, so it is Postgres' own
        # identifier rather than anything a caller supplied.
        count = conn.execute(f'SELECT count(*) AS n FROM "{name}"').fetchone()  # noqa: S608
        rows.append({"table": name, "rows": count["n"]})
    show(rows)


def describe(conn: psycopg.Connection, table: str) -> None:
    show(
        conn.execute(
            """
            SELECT column_name AS column, data_type AS type,
                   is_nullable AS nullable, column_default AS default
            FROM information_schema.columns
            WHERE table_name = %s AND table_schema = 'public'
            ORDER BY ordinal_position
            """,
            (table,),
        ).fetchall()
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "target",
        nargs="?",
        help="a table name, or a SQL statement. Omit for the table list.",
    )
    parser.add_argument("--rows", action="store_true", help="show a table's most recent rows")
    parser.add_argument("--limit", type=int, default=20, help="how many rows (default 20)")
    parser.add_argument(
        "--psql", action="store_true", help="open an interactive psql on this database instead"
    )
    args = parser.parse_args()

    if args.psql:
        binary = find_psql()
        if not binary:
            print(
                "psql was not found. It ships with PostgreSQL - on Windows look in\n"
                r"  C:\Program Files\PostgreSQL\<version>\bin\psql.exe",
                file=sys.stderr,
            )
            return 1
        # The DSN goes in the environment rather than argv: a connection string
        # on the command line is visible to every other process on the machine.
        env = {**os.environ, "PGSERVICEFILE": "", "DATABASE_URL": settings.dsn}
        # `binary` is a path this module chose, not caller input, and the
        # argument list form never reaches a shell.
        return subprocess.call([binary, settings.dsn], env=env)  # noqa: S603

    # Everything runs inside a transaction this never commits, so a mistyped
    # UPDATE in the query form changes nothing.
    with (
        psycopg.connect(settings.dsn, row_factory=dict_row) as conn,
        conn.transaction(force_rollback=True),
    ):
        if not args.target:
            list_tables(conn)
            return 0

        looks_like_sql = any(
            args.target.lstrip().lower().startswith(verb)
            for verb in ("select", "with", "insert", "update", "delete", "explain")
        )
        if looks_like_sql:
            result = conn.execute(args.target)
            show(result.fetchall() if result.description else [])
            return 0

        describe(conn, args.target)
        if args.rows:
            print()
            order = _newest_first(conn, args.target)
            show(
                conn.execute(
                    f'SELECT * FROM "{args.target}" {order} LIMIT {args.limit}'  # noqa: S608
                ).fetchall()
            )
        return 0


def _newest_first(conn: psycopg.Connection, table: str) -> str:
    """Order by whatever this table calls "when", so --rows shows recent work.

    Falls back to no ordering rather than guessing: a table with neither a
    created_at nor a serial id is one where "most recent" has no meaning.
    """
    columns = {
        r["column_name"]
        for r in conn.execute(
            "SELECT column_name FROM information_schema.columns WHERE table_name = %s",
            (table,),
        ).fetchall()
    }
    for candidate in ("created_at", "occurred_at", "recorded_at"):
        if candidate in columns:
            return f"ORDER BY {candidate} DESC"
    pk = f"{table}_id"
    return f"ORDER BY {pk} DESC" if pk in columns else ""


if __name__ == "__main__":
    raise SystemExit(main())
