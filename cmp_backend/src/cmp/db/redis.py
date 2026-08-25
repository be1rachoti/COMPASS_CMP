"""Redis client.

Used deliberately, for four things and no others (checklist §10):

* **Celery brokering** - a separate database index, so a `FLUSHDB` on the cache
  cannot silently discard queued work.
* **Sessions** - see `cmp.domain.sessions`. Deliberately not a database table:
  the 22 tables of DATA-MODEL.md are the record of what happened, and a session
  is not that. It is ephemeral state with a TTL, and it must disappear on its own
  when nobody comes back for it.
* **OTP and lockout counters** - short-lived by definition, and a counter that
  survives a restart is a counter that locks people out for the wrong reasons.
* **Locks and rate limits** - see `cmp.domain.ratelimit`.

Failure behaviour is explicit rather than incidental. Redis being unavailable
must not be the reason a consent artefact fails to write, but it also must not
silently disable a rate limit. Each caller states which it wants.
"""

from __future__ import annotations

from typing import Final

import redis.asyncio as aioredis
from redis.asyncio.client import Redis

from cmp.core.config import settings
from cmp.core.logging import get_logger

log = get_logger("cmp.redis")

_client: Redis | None = None

# Key prefixes. One namespace per concern so a targeted flush is possible and a
# stray SCAN pattern cannot match something it should not.
K_SESSION: Final = "sess"
K_USER_SESSIONS: Final = "usess"
K_OTP: Final = "otp"
K_OTP_ATTEMPTS: Final = "otpa"
K_MFA: Final = "mfa"
K_LOGIN_FAILS: Final = "lfail"
K_LOCKOUT: Final = "lock"
K_RATE: Final = "rate"
K_LOCK: Final = "mutex"
K_CACHE: Final = "cache"
K_IDEMPOTENCY: Final = "idem"


async def open_redis() -> Redis:
    global _client
    if _client is not None:
        return _client
    _client = aioredis.from_url(
        settings.redis_url,
        encoding="utf-8",
        decode_responses=True,
        socket_timeout=3.0,
        socket_connect_timeout=3.0,
        retry_on_timeout=True,
        health_check_interval=30,
        max_connections=50,
    )
    await _client.ping()
    log.info("redis.connected", url=_redacted_url(settings.redis_url))
    return _client


async def close_redis() -> None:
    global _client
    if _client is not None:
        await _client.aclose()
        log.info("redis.closed")
        _client = None


def get_redis() -> Redis:
    if _client is None:  # pragma: no cover - programming error
        raise RuntimeError("Redis is not connected. Call open_redis() in the lifespan.")
    return _client


async def healthcheck() -> bool:
    try:
        return bool(await get_redis().ping())
    except Exception:
        return False


def key(*parts: object) -> str:
    return ":".join(str(p) for p in parts)


def _redacted_url(url: str) -> str:
    """Never log the password embedded in a connection string."""
    if "@" not in url:
        return url
    scheme, _, rest = url.partition("://")
    _creds, _, host = rest.rpartition("@")
    return f"{scheme}://***@{host}"
