"""The things a permission can be about.

Sixteen names, each corresponding to one row of the API reference's permission
tables. They are strings rather than an enum for one reason: a route names its
resource inline — `RequireResource("project")` — and an enum member there would
be noise without adding safety, because `verify_resources()` below checks the
whole set at import.

**A resource absent from this module is denied to everyone.** That is the
default, and it is why adding an endpoint for something new fails closed rather
than open.
"""

from __future__ import annotations

from typing import Final

# --------------------------------------------------------------- identity
USER: Final = "user"
ME: Final = "me"

# --------------------------------------------------------------- registry
PURPOSE: Final = "purpose"
PROCESSOR: Final = "processor"
DATA_SOURCE: Final = "data_source"

# --------------------------------------------------------------- projects
PROJECT: Final = "project"
APPROVAL: Final = "approval"
SITE: Final = "site"

# ---------------------------------------------------------------- notices
NOTICE: Final = "notice"

# ---------------------------------------------------------------- consent
LINK: Final = "link"
CONSENT: Final = "consent"

# --------------------------------------------------------------- exchange
EXPORT: Final = "export"
IMPORT: Final = "import"
COLLECTION: Final = "collection"
ASSET: Final = "asset"

# ----------------------------------------------------------------- audit
AUDIT: Final = "audit"

#: Every resource this system knows about. `verify_resources()` asserts the
#: matrix and this set agree, so a resource named in one and not the other is an
#: import-time failure rather than a silent deny in production.
ALL: Final[frozenset[str]] = frozenset(
    {
        USER,
        ME,
        PURPOSE,
        PROCESSOR,
        DATA_SOURCE,
        PROJECT,
        APPROVAL,
        SITE,
        NOTICE,
        LINK,
        CONSENT,
        EXPORT,
        IMPORT,
        COLLECTION,
        ASSET,
        AUDIT,
    }
)
