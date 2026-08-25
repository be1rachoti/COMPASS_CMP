"""`core/enums.py` against the database that actually defines the vocabulary.

A hand-mirrored enum is only worth having if it cannot drift. Without this test
the failure mode is silent for months: somebody adds a label in a migration, the
Python enum does not grow a member, and the first anyone hears of it is a
constraint violation on a code path nobody exercised — or worse, a dropdown in
the console that is quietly missing an option.

The assertion runs both ways on purpose. A member the database does not have is
a value the application will offer and the database will refuse.
"""

from __future__ import annotations

from typing import Any

import pytest

from cmp.core.enums import BY_PG_TYPE

pytestmark = pytest.mark.integration


async def _labels(conn: Any, pg_type: str) -> list[str]:
    result = await conn.execute(
        """
        SELECT e.enumlabel
        FROM pg_type t
        JOIN pg_enum e      ON e.enumtypid = t.oid
        JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE n.nspname = 'public' AND t.typname = %s
        ORDER BY e.enumsortorder
        """,
        (pg_type,),
    )
    return [row["enumlabel"] for row in await result.fetchall()]


@pytest.mark.parametrize("pg_type", sorted(BY_PG_TYPE))
async def test_python_enum_matches_the_database(conn: Any, pg_type: str) -> None:
    """Same members, same order, in both directions."""
    database = await _labels(conn, pg_type)
    python = [member.value for member in BY_PG_TYPE[pg_type]]

    assert database, f"no PostgreSQL enum type named {pg_type!r}"

    missing = [label for label in database if label not in python]
    extra = [label for label in python if label not in database]

    assert not missing, (
        f"{pg_type}: the database accepts {missing} but core/enums.py does not offer them"
    )
    assert not extra, f"{pg_type}: core/enums.py offers {extra} but the database will refuse them"
    # Order carries meaning for the lifecycle enums — project_status is walked in
    # declaration order, and a reordering would silently change what "next" means.
    assert python == database, f"{pg_type}: order differs — {python} vs {database}"


async def test_every_database_enum_is_mirrored(conn: Any) -> None:
    """No enum type exists that Python knows nothing about.

    Catches the other direction: a migration adds a whole new type and nobody
    adds it here, so the reference endpoint that feeds the console's dropdowns
    silently has no entry for it.
    """
    result = await conn.execute(
        """
        SELECT t.typname
        FROM pg_type t
        JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE n.nspname = 'public' AND t.typtype = 'e'
        ORDER BY t.typname
        """
    )
    in_database = {row["typname"] for row in await result.fetchall()}
    unmirrored = sorted(in_database - set(BY_PG_TYPE))

    assert not unmirrored, (
        f"PostgreSQL enum type(s) {unmirrored} have no counterpart in core/enums.py"
    )
