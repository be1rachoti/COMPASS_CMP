"""What a route asks for.

Split by concern rather than by endpoint, because these are the security
boundary and each one should be readable on its own:

    sessions        cookie -> Session, and the two cookies we set
    csrf            the double-submit check, and why it is only on unsafe verbs
    authentication  Session -> Principal; full, partial and optional
    authorization   the route guards: RequireRole and RequireResource
    pagination      cursor, limit and the per-route sort allow-list
    filters         unknown query parameters are refused, never ignored
    common          the annotated aliases a route signature actually writes

Routes import from `common`. The rest is what `common` is made of.

Nothing here opens a transaction. A guard that wrote an audit row would be doing
it outside the transaction the service is about to start, so denials are audited
by the layer that has the connection.
"""

from __future__ import annotations

from cmp.api.dependencies.authentication import (
    current_principal,
    optional_principal,
    partial_principal,
)
from cmp.api.dependencies.authorization import RequireResource, RequireRole
from cmp.api.dependencies.common import (
    AuditReader,
    CollectionReader,
    ConsentReader,
    CurrentUser,
    ExportReader,
    LinkReader,
    MaybeUser,
    NoticeReader,
    PartialUser,
    ProjectReader,
    RequireAdmin,
    RequireDataSubject,
    RequireDPO,
    RequireDPOorAdmin,
    RequireStaff,
)
from cmp.api.dependencies.csrf import UNSAFE_METHODS, verify_csrf
from cmp.api.dependencies.filters import reject_unknown_filters
from cmp.api.dependencies.pagination import Paging
from cmp.api.dependencies.sessions import (
    clear_session_cookies,
    session_from_request,
    set_session_cookies,
)

__all__ = [
    "UNSAFE_METHODS",
    "AuditReader",
    "CollectionReader",
    "ConsentReader",
    "CurrentUser",
    "ExportReader",
    "LinkReader",
    "MaybeUser",
    "NoticeReader",
    "Paging",
    "PartialUser",
    "ProjectReader",
    "RequireAdmin",
    "RequireDPO",
    "RequireDPOorAdmin",
    "RequireDataSubject",
    "RequireResource",
    "RequireRole",
    "RequireStaff",
    "clear_session_cookies",
    "current_principal",
    "optional_principal",
    "partial_principal",
    "reject_unknown_filters",
    "session_from_request",
    "set_session_cookies",
    "verify_csrf",
]
