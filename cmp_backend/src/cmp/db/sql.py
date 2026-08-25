"""Small helpers shared by every repository.

There is no ORM here on purpose. The schema in DATA-MODEL.md is authoritative;
an ORM model is a second copy of it that drifts. Repositories write the SQL that
runs, and the constraints in the database are the last line of enforcement.

Everything is parameterised. The one identifier that must be interpolated - the
sort column - is validated against a route allow-list by `parse_page` before it
arrives here, and is quoted through psycopg's identifier composer.
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any

import psycopg
from psycopg import sql as pgsql

from cmp.core.errors import Conflict, NotFound
from cmp.core.pagination import PageRequest

Conn = psycopg.AsyncConnection[Any]
Row = dict[str, Any]
Params = Sequence[Any] | dict[str, Any]


async def fetch_one(conn: Conn, query: str, params: Params = ()) -> Row | None:
    cur = await conn.execute(query, params)
    row = await cur.fetchone()
    return dict(row) if row else None


async def fetch_all(conn: Conn, query: str, params: Params = ()) -> list[Row]:
    cur = await conn.execute(query, params)
    return [dict(r) for r in await cur.fetchall()]


async def fetch_val(conn: Conn, query: str, params: Params = ()) -> Any:
    row = await fetch_one(conn, query, params)
    if not row:
        return None
    return next(iter(row.values()))


async def execute(conn: Conn, query: str, params: Params = ()) -> int:
    cur = await conn.execute(query, params)
    return cur.rowcount


async def require_one(
    conn: Conn, query: str, params: Params = (), *, entity: str = "Resource"
) -> Row:
    """Fetch or 404.

    The scope predicate belongs inside `query`. A row the caller may not see is
    absent from the result, so this raises 404 - not 403, which would confirm it
    exists.
    """
    row = await fetch_one(conn, query, params)
    if row is None:
        raise NotFound(entity)
    return row


_TEMPORAL_SUFFIXES = ("_at", "_on")


def keyset_clause(req: PageRequest, *, alias: str, id_column: str) -> tuple[str, list[Any]]:
    """WHERE fragment plus ORDER BY/LIMIT for one keyset page.

    Row comparison `(sort, id) < (%s, %s)` is a single index seek against
    `(sort DESC, id DESC)`, which is why the DATA-MODEL indexes are declared that
    way. Comparing the columns separately with OR would not be.
    """
    direction = "DESC" if req.descending else "ASC"
    cmp_op = "<" if req.descending else ">"
    sort_col = pgsql.Identifier(req.sort_field).as_string(None)
    id_col = pgsql.Identifier(id_column).as_string(None)
    tbl = pgsql.Identifier(alias).as_string(None)

    where = ""
    params: list[Any] = []
    if req.cursor is not None:
        cast = "%s::timestamptz" if req.sort_field.endswith(_TEMPORAL_SUFFIXES) else "%s"
        where = f" AND ({tbl}.{sort_col}, {tbl}.{id_col}) {cmp_op} ({cast}, %s)"
        params = [req.cursor.sort_value, req.cursor.row_id]

    order = f" ORDER BY {tbl}.{sort_col} {direction}, {tbl}.{id_col} {direction} LIMIT %s"
    params.append(req.fetch_limit)
    return where + order, params


def unique_violation(exc: BaseException) -> bool:
    return isinstance(exc, psycopg.errors.UniqueViolation)


def as_conflict(exc: psycopg.Error, message: str, *, code: str = "conflict") -> Conflict:
    """Turn a constraint violation into a domain conflict.

    The constraint name is deliberately not echoed to the client - it leaks the
    schema. It is logged instead.
    """
    return Conflict(message, code=code, details={"pg_code": exc.sqlstate or "unknown"})
