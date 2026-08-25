"""The names routes actually write.

Every guard in this package composed into the annotated types a route signature
uses. A route says what it needs and gets it:

    async def list_projects(principal: ProjectReader, page: Paged) -> ...:

Collected here rather than defined beside each guard so that a reader can see
the whole vocabulary of route requirements in one screen — and so adding a new
one is a deliberate act in a file whose diff gets read.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import Depends

from cmp.api.dependencies.authentication import (
    current_principal,
    optional_principal,
    partial_principal,
)
from cmp.api.dependencies.authorization import RequireResource, RequireRole
from cmp.auth.identity import Principal
from cmp.core.permissions import Role

# ------------------------------------------------------------- who is calling
#: A full session. Anything less is 401.
CurrentUser = Annotated[Principal, Depends(current_principal)]

#: Password accepted, second factor outstanding. Authorises the MFA verify
#: route and nothing else — which is why it has a name of its own rather than
#: being a flag on CurrentUser that somebody forgets to check.
PartialUser = Annotated[Principal, Depends(partial_principal)]

#: Signed in or not. For routes that behave differently but work either way.
MaybeUser = Annotated[Principal | None, Depends(optional_principal)]

# ----------------------------------------------------------------- by role
RequireDPO = Annotated[Principal, Depends(RequireRole(Role.DPO))]
RequireAdmin = Annotated[Principal, Depends(RequireRole(Role.ADMIN))]
RequireDPOorAdmin = Annotated[Principal, Depends(RequireRole(Role.DPO, Role.ADMIN))]
RequireStaff = Annotated[
    Principal, Depends(RequireRole(Role.DPO, Role.DCO, Role.RND_USER, Role.ADMIN))
]
RequireDataSubject = Annotated[Principal, Depends(RequireRole(Role.DATA_SUBJECT))]

# ------------------------------------------------------------- by resource
# Read guards. The matrix decides, and the principal comes back carrying the row
# scope the repository will turn into a WHERE predicate.
ProjectReader = Annotated[Principal, Depends(RequireResource("project"))]
NoticeReader = Annotated[Principal, Depends(RequireResource("notice"))]
ConsentReader = Annotated[Principal, Depends(RequireResource("consent"))]
LinkReader = Annotated[Principal, Depends(RequireResource("link"))]
ExportReader = Annotated[Principal, Depends(RequireResource("export"))]
CollectionReader = Annotated[Principal, Depends(RequireResource("collection"))]
AuditReader = Annotated[Principal, Depends(RequireResource("audit"))]
