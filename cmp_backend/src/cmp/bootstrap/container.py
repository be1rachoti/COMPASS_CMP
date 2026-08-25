"""Wiring the swappable pieces.

Not a dependency-injection framework, and deliberately not one. This codebase
has exactly four things that vary by environment — the email transport, the SMS
transport, the file storage backend, and the Redis client — and each is already
chosen by a `build_*` function reading configuration.

What this module adds is a single place to *see* those choices, and one call to
warm them at startup rather than lazily on the first request. Building the
storage backend inside the first upload means the first upload is the one that
discovers the bucket name is wrong.

If a fifth seam appears, it goes here. If a fifteenth does, that is the moment
to reach for a container library — not before.
"""

from __future__ import annotations

from cmp.core.config import settings
from cmp.core.logging import get_logger
from cmp.infrastructure.email import build_email_transport
from cmp.infrastructure.sms import build_sms_transport
from cmp.infrastructure.storage import build_storage

log = get_logger("cmp.bootstrap.container")


def warm() -> None:
    """Construct the configured adapters once, at startup.

    Logged so an operator can see in the first ten lines which transports this
    process is actually using — the difference between "email is configured" and
    "email is writing to a file in var/" is one that costs a support cycle to
    discover any other way.
    """
    email = build_email_transport()
    sms = build_sms_transport()
    storage = build_storage()

    log.info(
        "container.ready",
        email=type(email).__name__,
        sms=type(sms).__name__,
        storage=type(storage).__name__,
        environment=settings.environment,
    )
