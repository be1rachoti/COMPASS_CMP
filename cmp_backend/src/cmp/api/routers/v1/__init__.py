"""Version 1 of the authenticated API.

Every route here requires a session, and every one names its guard in its
signature — a route with no guard is a route that is open, and that should be
visible on the line that declares it rather than inferred from its absence.

Versioned as a package rather than a URL prefix. The paths are unprefixed today
because the console is the only client and ships with the API; when a second
client exists, a `v2` package can carry changed contracts while `v1` keeps
serving the first one, and the mount point is one line in `bootstrap.routers`.
"""

from cmp.api.routers.v1.audit import router as audit_router
from cmp.api.routers.v1.auth import router as auth_router
from cmp.api.routers.v1.consents import router as consents_router
from cmp.api.routers.v1.dashboard import router as dashboard_router
from cmp.api.routers.v1.delegations import router as delegations_router
from cmp.api.routers.v1.exchange import router as exchange_router
from cmp.api.routers.v1.me import router as me_router
from cmp.api.routers.v1.notices import router as notices_router
from cmp.api.routers.v1.projects import router as projects_router
from cmp.api.routers.v1.registry import router as registry_router
from cmp.api.routers.v1.system import router as system_router
from cmp.api.routers.v1.users import router as users_router

__all__ = [
    "audit_router",
    "auth_router",
    "consents_router",
    "dashboard_router",
    "delegations_router",
    "exchange_router",
    "me_router",
    "notices_router",
    "projects_router",
    "registry_router",
    "system_router",
    "users_router",
]
