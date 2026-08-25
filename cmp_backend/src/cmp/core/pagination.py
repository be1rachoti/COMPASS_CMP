"""Cursor pagination — every list endpoint, no exceptions.

Offset pagination silently skips or repeats rows when the underlying set changes
between pages, which it will during a collection campaign. A cursor is a keyset:
(sort value, tie-breaking id). The client gets it back opaque so nobody starts
hand-crafting one.

The cursor is signed. An unsigned cursor is an injection vector into the ORDER BY
of the next query; a signed one either verifies or is a 400.
"""

from __future__ import annotations

import base64
import binascii
import hmac
import json
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Generic, TypeVar

from cmp.core.config import settings
from cmp.core.errors import BadRequest

T = TypeVar("T")


@dataclass(frozen=True, slots=True)
class Cursor:
    """Keyset position: everything strictly after (sort_value, row_id)."""

    sort_value: str
    row_id: int

    def encode(self) -> str:
        payload = json.dumps({"v": self.sort_value, "i": self.row_id}, separators=(",", ":"))
        raw = payload.encode("utf-8")
        sig = hmac.new(
            settings.secret_key.get_secret_value().encode("utf-8"), raw, "sha256"
        ).digest()[:12]
        return base64.urlsafe_b64encode(raw + b"." + sig).rstrip(b"=").decode("ascii")

    @classmethod
    def decode(cls, token: str) -> Cursor:
        try:
            padded = token + "=" * (-len(token) % 4)
            blob = base64.urlsafe_b64decode(padded.encode("ascii"))
            raw, _, sig = blob.rpartition(b".")
            expected = hmac.new(
                settings.secret_key.get_secret_value().encode("utf-8"), raw, "sha256"
            ).digest()[:12]
            if not raw or not hmac.compare_digest(sig, expected):
                raise BadRequest("Malformed cursor", code="bad_cursor", field="cursor")
            data = json.loads(raw.decode("utf-8"))
            return cls(sort_value=str(data["v"]), row_id=int(data["i"]))
        except BadRequest:
            raise
        except (ValueError, KeyError, TypeError, binascii.Error) as exc:
            raise BadRequest("Malformed cursor", code="bad_cursor", field="cursor") from exc


@dataclass(frozen=True, slots=True)
class PageRequest:
    limit: int
    cursor: Cursor | None
    sort_field: str
    descending: bool

    @property
    def fetch_limit(self) -> int:
        """One extra row tells us whether a next page exists without a second query."""
        return self.limit + 1


@dataclass(frozen=True, slots=True)
class Page(Generic[T]):
    items: list[T]
    next_cursor: str | None
    total: int | None = None

    def as_dict(self) -> dict[str, Any]:
        return {"items": self.items, "next_cursor": self.next_cursor, "total": self.total}


def parse_page(
    *,
    limit: int | None,
    cursor: str | None,
    sort: str | None,
    allowed_sorts: Sequence[str],
    default_sort: str,
) -> PageRequest:
    """Validate paging inputs. An unknown sort field is a 400, never a silent default."""
    eff_limit = limit if limit is not None else settings.default_page_size
    if eff_limit < 1 or eff_limit > settings.max_page_size:
        raise BadRequest(
            f"limit must be between 1 and {settings.max_page_size}",
            code="bad_limit",
            field="limit",
        )

    raw = sort or default_sort
    descending = raw.startswith("-")
    field = raw.removeprefix("-")
    if field not in allowed_sorts:
        raise BadRequest(
            f"Unsupported sort field '{field}'. Allowed: {', '.join(sorted(allowed_sorts))}",
            code="bad_sort",
            field="sort",
        )

    return PageRequest(
        limit=eff_limit,
        cursor=Cursor.decode(cursor) if cursor else None,
        sort_field=field,
        descending=descending,
    )


def build_page(
    rows: list[dict[str, Any]],
    req: PageRequest,
    *,
    total: int | None = None,
    id_key: str = "_row_id",
) -> tuple[list[dict[str, Any]], str | None]:
    """Trim the probe row and mint the next cursor from the last kept row."""
    has_more = len(rows) > req.limit
    kept = rows[: req.limit]
    next_cursor: str | None = None
    if has_more and kept:
        last = kept[-1]
        value = last.get(req.sort_field)
        if isinstance(value, datetime):
            value = value.isoformat()
        next_cursor = Cursor(sort_value=str(value), row_id=int(last[id_key])).encode()
    for row in kept:
        row.pop(id_key, None)  # the int primary key never leaves the process
    return kept, next_cursor
