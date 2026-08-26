"""Router registry.

`ROUTERS` is the order routes are registered, which is also the order they are
matched. One placement is load-bearing: the **public** routers come before the
authenticated ones, so `/c/{token}` can never be shadowed by a path parameter on
another router.

The rest of the order is grouped for reading — identity, then the registry, then
the project lifecycle, then oversight — and nothing depends on it.
"""

from __future__ import annotations

from fastapi import APIRouter

from cmp.api.routers import public, v1

ROUTERS: tuple[APIRouter, ...] = (
    # System first: health and readiness must answer even if something below
    # fails to import cleanly in a partial deploy.
    v1.system_router,
    v1.auth_router,
    # Public before authenticated — see the module docstring.
    public.consent_router,
    public.rights_router,
    # Identity and the reference registry.
    v1.users_router,
    v1.me_router,
    v1.delegations_router,
    v1.registry_router,
    # The project lifecycle, in the order it is walked.
    v1.projects_router,
    v1.notices_router,
    v1.consents_router,
    v1.exchange_router,
    # Oversight.
    v1.audit_router,
    v1.dashboard_router,
)

__all__ = ["ROUTERS"]
