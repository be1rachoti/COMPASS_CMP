"""Mounting the routers.

One line today, and that is the point of having the file: when a `v2` package
exists, the mount points live here rather than being threaded through the
application factory.
"""

from __future__ import annotations

from fastapi import FastAPI

from cmp.api.routers import ROUTERS


def install(app: FastAPI) -> None:
    for router in ROUTERS:
        app.include_router(router)
