"""Pagination input validation.

The cursor is opaque and signed; this module is only concerned with the
parameters a client may set around it. Anything cleverer — decoding the cursor,
building the keyset predicate — belongs to `cmp.core.pagination`, which is where
the signing key is.
"""

from __future__ import annotations

from typing import Annotated

from pydantic import Field, StringConstraints

from cmp.core.config import settings

#: Bounded at both ends. No limit at all lets one request ask for the table;
#: a limit of zero is a request nobody meant to make.
PageLimit = Annotated[int, Field(ge=1, le=settings.max_page_size)]

#: The opaque cursor. Character class is what the encoder emits, so a mangled
#: value is refused here rather than failing signature verification later with a
#: less useful message.
Cursor = Annotated[
    str,
    StringConstraints(min_length=8, max_length=512, pattern=r"^[A-Za-z0-9_.\-]+$"),
]

#: `-field` for descending. The field itself is checked against a per-route
#: allow-list in `core.pagination`, never interpolated from here.
SortSpec = Annotated[str, StringConstraints(max_length=60, pattern=r"^-?[a-z_]+$")]

#: A free-text search term. Bounded because it reaches an ILIKE, and an
#: unbounded pattern is a way to make the database work hard for one request.
SearchTerm = Annotated[str, StringConstraints(min_length=1, max_length=100)]
