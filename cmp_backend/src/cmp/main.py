"""ASGI entrypoint.

Deliberately thin. Everything that assembles the application lives in
`cmp.bootstrap`; this module exists so `uvicorn cmp.main:app` and
`gunicorn cmp.main:app` have a stable target that will not move when the
assembly is reorganised again.

The one thing it does beyond re-exporting is set the event loop policy, and that
has to happen before anything creates a loop.
"""

from __future__ import annotations

import asyncio
import sys

from fastapi import FastAPI

from cmp.bootstrap import create_app


def configure_event_loop() -> None:
    """psycopg's async mode cannot run on Windows' ProactorEventLoop.

    Without this the API runs on Linux and in CI but not on a Windows developer
    machine — and "works on the server" is a poor answer to somebody trying to
    reproduce a bug locally.

    Note that uvicorn 0.36+ constructs its loop through `loop_factory`, which
    *bypasses* the policy set here. `cmp.__main__` supplies the loop directly for
    that reason; this covers every other entrypoint.
    """
    if sys.platform == "win32":
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())


configure_event_loop()

app: FastAPI = create_app()

__all__ = ["app", "create_app"]
