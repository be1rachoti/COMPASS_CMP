"""Constrained text types.

Every string crossing the API boundary is one of these, never a bare `str`. The
constraint travels with the type, so a field cannot be added to a model without
somebody deciding how long it may be — which is the whole point: an unbounded
string field is a memory-exhaustion vector and a database error waiting for the
first user who pastes a document into a name box.

Bounds are chosen from what the column actually holds, not rounded to a
comfortable number. Where a bound here disagrees with the schema, the schema
wins and this file is wrong.
"""

from __future__ import annotations

from typing import Annotated

from pydantic import StringConstraints

#: A name, a label, a reference. Matches the `varchar(200)` family.
ShortText = Annotated[str, StringConstraints(min_length=1, max_length=200)]

#: A description, a notice rendition, a reason. 20k is roughly forty pages —
#: generous for prose, and still a bound.
LongText = Annotated[str, StringConstraints(min_length=1, max_length=20_000)]

#: A free-text reason attached to a state change. Optional at the call site, so
#: no minimum length is imposed here.
ReasonText = Annotated[str, StringConstraints(max_length=1000)]

#: An organisation-supplied identifier that appears in URLs and exports.
#: Deliberately narrow: letters, digits, dot, dash, underscore, and it must not
#: start with a separator. A code containing a slash or a space breaks a path
#: and a CSV column on the same day.
CodeText = Annotated[
    str,
    StringConstraints(min_length=1, max_length=80, pattern=r"^[A-Za-z0-9][A-Za-z0-9._-]*$"),
]

#: A contract reference, a manifest reference — external strings we echo back
#: but never parse.
RefText = Annotated[str, StringConstraints(min_length=1, max_length=120)]
