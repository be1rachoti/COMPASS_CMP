"""Re-export of the route dependencies.

The dependencies themselves live in `cmp.api.dependencies`, next to the request
handling they guard. This module exists so `bootstrap` presents one surface for
"everything needed to stand the application up", and so a reader looking for the
guards from the assembly side finds a pointer rather than nothing.

There is no logic here on purpose. A second definition of a guard is a second
answer to "is this allowed", and one of them will be wrong.
"""

from cmp.api.dependencies import (
    CurrentUser,
    MaybeUser,
    Paging,
    PartialUser,
    RequireAdmin,
    RequireDataSubject,
    RequireDPO,
    RequireDPOorAdmin,
    RequireResource,
    RequireRole,
    RequireStaff,
    reject_unknown_filters,
)

__all__ = [
    "CurrentUser",
    "MaybeUser",
    "Paging",
    "PartialUser",
    "RequireAdmin",
    "RequireDPO",
    "RequireDPOorAdmin",
    "RequireDataSubject",
    "RequireResource",
    "RequireRole",
    "RequireStaff",
    "reject_unknown_filters",
]
