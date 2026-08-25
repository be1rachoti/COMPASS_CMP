"""Structured logging with correlation IDs.

Every line carries timestamp, level, service, environment, request_id and the
actor. The correlation id is generated at the edge, propagated to Celery through
task headers and to external services through an outbound header, so one id
follows a request from the proxy to the last integration.

Nothing here may log a secret. `redact_processor` scrubs known-sensitive keys
before the event leaves the process.
"""

from __future__ import annotations

import logging
import sys
from collections.abc import MutableMapping
from typing import Any

import structlog

from cmp.core.config import settings
from cmp.core.context import current_context

_SENSITIVE_KEYS = frozenset(
    {
        "password",
        "password_hash",
        "new_password",
        "current_password",
        "secret",
        "secret_key",
        "token",
        "access_token",
        "refresh_token",
        "session_token",
        "csrf_token",
        "otp",
        "otp_code",
        "code",
        "authorization",
        "cookie",
        "set-cookie",
        "api_key",
        "private_key",
    }
)
_REDACTED = "[redacted]"


def redact_processor(
    _logger: Any, _name: str, event_dict: MutableMapping[str, Any]
) -> MutableMapping[str, Any]:
    for key in list(event_dict):
        if key.lower() in _SENSITIVE_KEYS:
            event_dict[key] = _REDACTED
    return event_dict


def context_processor(
    _logger: Any, _name: str, event_dict: MutableMapping[str, Any]
) -> MutableMapping[str, Any]:
    ctx = current_context()
    event_dict.setdefault("request_id", ctx.request_id)
    if ctx.actor_uuid:
        event_dict.setdefault("actor", ctx.actor_uuid)
        event_dict.setdefault("actor_role", ctx.actor_role)
    return event_dict


def static_fields(
    _logger: Any, _name: str, event_dict: MutableMapping[str, Any]
) -> MutableMapping[str, Any]:
    event_dict.setdefault("service", settings.service_name)
    event_dict.setdefault("env", settings.environment)
    event_dict.setdefault("version", settings.version)
    return event_dict


def configure_logging() -> None:
    """Idempotent — safe to call from the app factory and from a Celery worker."""
    level = getattr(logging, settings.log_level.upper(), logging.INFO)

    shared: list[Any] = [
        structlog.contextvars.merge_contextvars,
        structlog.stdlib.add_log_level,
        structlog.stdlib.add_logger_name,
        static_fields,
        context_processor,
        redact_processor,
        structlog.processors.TimeStamper(fmt="iso", utc=True),
        structlog.processors.StackInfoRenderer(),
        structlog.processors.UnicodeDecoder(),
    ]

    renderer: Any = (
        structlog.processors.JSONRenderer()
        if settings.log_json
        else structlog.dev.ConsoleRenderer(colors=True)
    )

    # One rendering path for structlog and stdlib alike: structlog hands the event
    # dict to a stdlib handler, and ProcessorFormatter renders both.
    structlog.configure(
        processors=[*shared, structlog.stdlib.ProcessorFormatter.wrap_for_formatter],
        wrapper_class=structlog.stdlib.BoundLogger,
        logger_factory=structlog.stdlib.LoggerFactory(),
        cache_logger_on_first_use=True,
    )

    # Route stdlib loggers (uvicorn, sqlalchemy, celery) through the same renderer.
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(
        structlog.stdlib.ProcessorFormatter(
            foreign_pre_chain=shared,
            processors=[
                structlog.stdlib.ProcessorFormatter.remove_processors_meta,
                structlog.processors.format_exc_info,
                renderer,
            ],
        )
    )
    root = logging.getLogger()
    root.handlers = [handler]
    root.setLevel(level)

    for noisy in ("uvicorn.access", "uvicorn.error", "httpx", "httpcore"):
        logging.getLogger(noisy).handlers = []
        logging.getLogger(noisy).propagate = True

    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)


def get_logger(name: str = "cmp") -> structlog.stdlib.BoundLogger:
    return structlog.get_logger(name)  # type: ignore[no-any-return]
