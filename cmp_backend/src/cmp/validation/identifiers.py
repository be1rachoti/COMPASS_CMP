"""Identifier types.

One rule, enforced by the absence of an alternative: **every identifier crossing
the API boundary is a uuid.** There is no `IntId` in this module and no
serialiser anywhere that would emit one.

That is not stylistic. A sequential integer in a response body tells the reader
how many rows exist and lets them walk the neighbours; it also becomes part of
the contract the moment somebody reads it off the wire, at which point the
surrogate key can never be renumbered. The internal integer stays internal: the
repositories select it, the services pass it around, and the response models
filter it out.
"""

from __future__ import annotations

from typing import Annotated
from uuid import UUID

from pydantic import Field, StringConstraints

#: The public identifier of any row. Pydantic parses and re-serialises it, so a
#: malformed uuid is a 422 from the framework rather than a 500 from psycopg.
Uuid = UUID

#: An organisation's own identifier for a person — an employee number, a
#: registration id. Opaque to us; we store and echo it, never interpret it.
OrganizationId = Annotated[str, StringConstraints(min_length=1, max_length=80)]

#: A capability token from a consent link URL. Compared in constant time and
#: never logged; the length bound stops a multi-megabyte path from reaching the
#: hasher at all.
LinkToken = Annotated[
    str, StringConstraints(min_length=16, max_length=128, pattern=r"^[A-Za-z0-9_-]+$")
]

#: A surrogate key, for the rare internal signature that must accept one. It is
#: not exported to any request or response model — if this appears in
#: `api/schemas/`, that is the bug.
InternalId = Annotated[int, Field(ge=1)]
