"""Assembling the application.

Everything that turns a collection of modules into a running service, split so
each step is independently readable:

    application  create_app() — the factory
    lifespan     open at startup, close in reverse at shutdown
    middleware   the stack, outermost first
    routers      what is mounted
    container    which swappable adapters this environment resolved to
    dependencies re-exported so a route imports from one place

Nothing here is imported by a route or a service. The dependency runs one way:
bootstrap knows about every layer, and no layer knows about bootstrap.
"""

from cmp.bootstrap.application import create_app

__all__ = ["create_app"]
