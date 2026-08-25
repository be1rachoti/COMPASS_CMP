"""The paging dependency.

Cursor, limit and sort — and the sort field is checked against a **per-route
allow-list**, never taken as given. That check is the only thing standing
between a query parameter and an ORDER BY clause, and the repositories build
that clause by interpolation because SQL takes no bind parameter for an
identifier.

A route declares what it can sort by; anything else is a 400 naming the
permitted values, not a 500 from the database.
"""

from __future__ import annotations

from collections.abc import Iterable
from typing import Annotated

from fastapi import Query

from cmp.core.config import settings
from cmp.core.pagination import PageRequest, parse_page


class Paging:
    """Validated cursor paging for one route's allow-list of sort fields.

    The allow-list is per route because the sort column is interpolated into SQL.
    A shared list would eventually contain a column some table does not have.
    """

    def __init__(self, allowed_sorts: Iterable[str], default_sort: str) -> None:
        self.allowed = tuple(allowed_sorts)
        self.default = default_sort

    async def __call__(
        self,
        limit: Annotated[int | None, Query(ge=1, le=settings.max_page_size)] = None,
        cursor: Annotated[str | None, Query(max_length=512)] = None,
        sort: Annotated[str | None, Query(max_length=64)] = None,
    ) -> PageRequest:
        return parse_page(
            limit=limit,
            cursor=cursor,
            sort=sort,
            allowed_sorts=self.allowed,
            default_sort=self.default,
        )
