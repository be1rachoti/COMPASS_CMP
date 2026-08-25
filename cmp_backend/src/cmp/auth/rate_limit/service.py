"""Rate limiting, account lockout and distributed locks.

Rate limits are on the public surface, where there is no session to hold anyone
accountable (API reference §1.6):

    POST /c/{token}/otp         5 per hour per contact, 20 per hour per token
    POST /c/{token}/otp/verify  5 per code, then the code is discarded
    POST /auth/login            5 per 30 min per account (R-AUT-03 lockout)
    GET  /c/{token}             60 per minute per IP

Sliding window, not fixed: a fixed window lets an attacker send the full quota at
59.9s and again at 60.1s, which is twice the limit in a fifth of a second. The
sorted-set implementation costs one round trip and gets the arithmetic right.

**Failure behaviour is explicit.** If Redis is unavailable, a rate limiter that
fails open removes the control exactly when the system is already degraded, and
one that fails closed turns a cache outage into a total outage. So the caller
decides, per limiter, and the default for authentication is closed.
"""

from __future__ import annotations

import time
import uuid as uuidlib
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass

from redis.exceptions import RedisError

from cmp.core.config import settings
from cmp.core.errors import RateLimited, ServiceUnavailable
from cmp.core.logging import get_logger
from cmp.db.redis import K_LOCK, K_LOCKOUT, K_LOGIN_FAILS, K_RATE, get_redis, key

log = get_logger("cmp.ratelimit")


@dataclass(frozen=True, slots=True)
class Verdict:
    allowed: bool
    remaining: int
    retry_after_s: int


async def check(
    bucket: str,
    identity: str,
    *,
    limit: int,
    window_s: int,
    fail_open: bool = False,
) -> Verdict:
    """Consume one unit from a sliding window. Does not raise; see `enforce`."""
    k = key(K_RATE, bucket, identity)
    now = time.time()
    cutoff = now - window_s

    try:
        r = get_redis()
        pipe = r.pipeline()
        pipe.zremrangebyscore(k, 0, cutoff)          # drop what left the window
        pipe.zadd(k, {f"{now}:{uuidlib.uuid4().hex}": now})
        pipe.zcard(k)
        pipe.expire(k, window_s + 1)
        results = await pipe.execute()
        used = int(results[2])
    except (RedisError, RuntimeError) as exc:
        if fail_open:
            log.warning("ratelimit.degraded_open", bucket=bucket, error=str(exc))
            return Verdict(allowed=True, remaining=limit, retry_after_s=0)
        log.error("ratelimit.degraded_closed", bucket=bucket, error=str(exc))
        raise ServiceUnavailable("Rate limiting is unavailable") from exc

    if used > limit:
        return Verdict(allowed=False, remaining=0, retry_after_s=window_s)
    return Verdict(allowed=True, remaining=max(0, limit - used), retry_after_s=0)


async def enforce(
    bucket: str,
    identity: str,
    *,
    limit: int,
    window_s: int,
    fail_open: bool = False,
    message: str = "Too many requests",
) -> None:
    verdict = await check(bucket, identity, limit=limit, window_s=window_s, fail_open=fail_open)
    if not verdict.allowed:
        log.warning("ratelimit.exceeded", bucket=bucket, limit=limit, window_s=window_s)
        raise RateLimited(message, retry_after_s=verdict.retry_after_s)


# ------------------------------------------------------------ account lockout
async def record_login_failure(account: str) -> int:
    """R-AUT-03: count failures and lock the account when the threshold is reached.

    Keyed on the account, not the source address: an attacker rotates addresses,
    and a per-IP counter protects nobody. The cost is that a determined attacker
    can lock a known account out - which is why the lock expires on its own
    rather than requiring an administrator.
    """
    r = get_redis()
    k = key(K_LOGIN_FAILS, account.lower())
    pipe = r.pipeline()
    pipe.incr(k)
    pipe.expire(k, settings.login_lockout_window_s)
    fails = int((await pipe.execute())[0])

    if fails >= settings.login_max_attempts:
        await r.setex(key(K_LOCKOUT, account.lower()), settings.login_lockout_duration_s, "1")
        log.warning("auth.locked_out", account_hash=_obscure(account), failures=fails)
    return fails


async def clear_login_failures(account: str) -> None:
    r = get_redis()
    await r.delete(key(K_LOGIN_FAILS, account.lower()), key(K_LOCKOUT, account.lower()))


async def is_locked_out(account: str) -> int:
    """Remaining lockout in seconds, or 0."""
    try:
        ttl = await get_redis().ttl(key(K_LOCKOUT, account.lower()))
    except (RedisError, RuntimeError) as exc:
        # Authentication fails closed. An unavailable lockout store must not
        # become an unlimited-attempts window.
        raise ServiceUnavailable("Authentication is temporarily unavailable") from exc
    return max(0, ttl)


def _obscure(value: str) -> str:
    """Enough to correlate log lines, not enough to identify the account."""
    import hashlib

    return hashlib.sha256(value.lower().encode()).hexdigest()[:12]


# -------------------------------------------------------------------- locking
@asynccontextmanager
async def lock(name: str, *, ttl_s: int = 30, wait_s: float = 0) -> AsyncIterator[bool]:
    """Best-effort mutex across processes.

    Used where at-least-once delivery meets a non-idempotent side effect - a
    scheduled sweep that must not run twice concurrently. It is not a correctness
    boundary: the TTL can expire while the holder is still working. Anything that
    must be exactly-once is made idempotent in the database instead, which is why
    imports upsert on (source, source_reference).
    """
    k = key(K_LOCK, name)
    token = uuidlib.uuid4().hex
    r = get_redis()
    deadline = time.monotonic() + wait_s
    acquired = False

    while True:
        acquired = bool(await r.set(k, token, nx=True, ex=ttl_s))
        if acquired or time.monotonic() >= deadline:
            break
        await _sleep(0.1)

    try:
        yield acquired
    finally:
        if acquired:
            # Release only our own hold - a naive DELETE would release a lock the
            # next holder acquired after ours expired.
            await r.eval(
                "if redis.call('get', KEYS[1]) == ARGV[1] "
                "then return redis.call('del', KEYS[1]) else return 0 end",
                1,
                k,
                token,
            )


async def _sleep(seconds: float) -> None:
    import asyncio

    await asyncio.sleep(seconds)
