"""Router registry.

Order is registration order, which is also the order routes are matched. The
public consent flow is registered before the authenticated resources so that
`/c/{token}` can never be shadowed by a path parameter on another router.
"""

from __future__ import annotations

from fastapi import APIRouter

from cmp.api.routers import (
    audit,
    auth,
    consents,
    dashboard,
    exchange,
    me,
    notices,
    projects,
    public,
    registry,
    system,
    users,
)

ROUTERS: tuple[APIRouter, ...] = (
    system.router,
    auth.router,
    public.router,
    users.router,
    me.router,
    registry.router,
    projects.router,
    notices.router,
    consents.router,
    exchange.router,
    audit.router,
    dashboard.router,
)

__all__ = ["ROUTERS"]
