"""URL types.

A notice carries three URLs a data subject has to be able to open: how to
withdraw, how to exercise their rights, and how to complain to the Data
Protection Board. They end up in text that is frozen and hashed at publication,
so a bad one is not editable afterwards — it is a new notice version.

Hence the scheme restriction. `javascript:` and `data:` are not links a person
can act on; they are ways to put executable content into a legal document.
"""

from __future__ import annotations

from typing import Annotated

from pydantic import StringConstraints

#: http(s) only. Bounded at 2000 characters because that is where browsers and
#: proxies start truncating, and a truncated withdrawal URL is worse than a
#: rejected one.
HttpUrl = Annotated[
    str,
    StringConstraints(min_length=8, max_length=2000, pattern=r"^https?://[^\s<>\"]+$"),
]

#: A storage reference recorded against an asset. Free-form because the source
#: system chooses it (`s3://…`, a UNC path, an internal id) — bounded, and never
#: dereferenced by us.
StorageRef = Annotated[str, StringConstraints(min_length=1, max_length=500)]
