"""Server-side sessions.

Cookie-based, not a bearer token in localStorage: an HttpOnly cookie is not
readable by script, which removes the whole class of "XSS exfiltrates the token"
from the board. The cost is CSRF, which the double-submit token in
`cmp.core.security` pays for.

The cookie carries an opaque random token. What Redis stores is its keyed
digest, so a dump of the session store is not a set of usable credentials.

Two clocks, both required:

* **Absolute lifetime** (`session_ttl_s`) - a session dies at a fixed age no
  matter how active it is. Without it, an attacker who gets a session keeps it
  indefinitely by using it.
* **Idle timeout** (`session_idle_timeout_s`) - a session dies after inactivity.
  Without it, an unattended workstation stays signed in all day.

A *partial* session exists between password verification and MFA. It authorises
exactly one route - `/auth/mfa/verify` - and nothing else accepts it.
"""

from __future__ import annotations

import time
import uuid as uuidlib
from dataclasses import dataclass
from typing import Any

from cmp.core.config import settings
from cmp.core.logging import get_logger
from cmp.core.security import new_token, token_fingerprint
from cmp.db.redis import K_SESSION, K_USER_SESSIONS, get_redis, key

log = get_logger("cmp.sessions")


@dataclass(frozen=True, slots=True)
class Session:
    sid: str  # public identifier, used by DELETE /auth/sessions/{uuid}
    user_id: int
    user_uuid: str
    role: str
    created_at: float
    last_seen_at: float
    expires_at: float
    ip_address: str | None
    user_agent: str | None
    mfa_verified: bool
    partial: bool  # password accepted, MFA outstanding
    csrf_token: str

    @property
    def idle_seconds(self) -> float:
        return time.time() - self.last_seen_at

    @property
    def is_expired(self) -> bool:
        now = time.time()
        return now >= self.expires_at or (now - self.last_seen_at) > settings.session_idle_timeout_s

    def to_public(self) -> dict[str, Any]:
        """What GET /auth/sessions may show. No token, no fingerprint."""
        return {
            "uuid": self.sid,
            "created_at": _iso(self.created_at),
            "last_seen_at": _iso(self.last_seen_at),
            "expires_at": _iso(self.expires_at),
            "ip_address": self.ip_address,
            "user_agent": self.user_agent,
            "mfa_verified": self.mfa_verified,
        }


def _iso(ts: float) -> str:
    from datetime import UTC, datetime

    return datetime.fromtimestamp(ts, tz=UTC).isoformat()


def _skey(fingerprint: str) -> str:
    return key(K_SESSION, fingerprint)


def _ukey(user_id: int) -> str:
    return key(K_USER_SESSIONS, user_id)


async def create(
    *,
    user_id: int,
    user_uuid: str,
    role: str,
    ip_address: str | None,
    user_agent: str | None,
    partial: bool = False,
    mfa_verified: bool = False,
) -> tuple[str, Session]:
    """Mint a session. Returns (raw token for the cookie, session record)."""
    token = new_token(32)
    fp = token_fingerprint(token)
    now = time.time()
    sid = str(uuidlib.uuid4())
    csrf = new_token(32)
    ttl = settings.mfa_ttl_s if partial else settings.session_ttl_s

    record = {
        "sid": sid,
        "user_id": str(user_id),
        "user_uuid": user_uuid,
        "role": role,
        "created_at": str(now),
        "last_seen_at": str(now),
        "expires_at": str(now + ttl),
        "ip_address": ip_address or "",
        "user_agent": (user_agent or "")[:300],
        "mfa_verified": "1" if mfa_verified else "0",
        "partial": "1" if partial else "0",
        "csrf_token": csrf,
    }

    r = get_redis()
    pipe = r.pipeline()
    pipe.hset(_skey(fp), mapping=record)
    pipe.expire(_skey(fp), ttl)
    pipe.sadd(_ukey(user_id), fp)
    # The index outlives any single session so a stale member is possible; every
    # read path tolerates a missing hash and prunes it.
    pipe.expire(_ukey(user_id), settings.session_ttl_s * 2)
    await pipe.execute()

    log.info("session.created", user_id=user_id, sid=sid, partial=partial)
    return token, _from_mapping(record)


def _from_mapping(m: dict[str, str]) -> Session:
    return Session(
        sid=m["sid"],
        user_id=int(m["user_id"]),
        user_uuid=m["user_uuid"],
        role=m["role"],
        created_at=float(m["created_at"]),
        last_seen_at=float(m["last_seen_at"]),
        expires_at=float(m["expires_at"]),
        ip_address=m.get("ip_address") or None,
        user_agent=m.get("user_agent") or None,
        mfa_verified=m.get("mfa_verified") == "1",
        partial=m.get("partial") == "1",
        csrf_token=m.get("csrf_token", ""),
    )


async def load(token: str) -> Session | None:
    """Resolve a cookie token to a live session, sliding the idle window."""
    fp = token_fingerprint(token)
    r = get_redis()
    m = await r.hgetall(_skey(fp))
    if not m:
        return None

    session = _from_mapping(m)
    if session.is_expired:
        await destroy(token)
        log.info("session.expired", sid=session.sid, user_id=session.user_id)
        return None

    # Slide the idle window. Writing on every request is one cheap HSET; the
    # alternative is a session that expires while someone is actively using it.
    now = time.time()
    if now - session.last_seen_at > 5:  # coalesce chatty clients
        pipe = r.pipeline()
        pipe.hset(_skey(fp), "last_seen_at", str(now))
        pipe.expire(_skey(fp), max(1, int(session.expires_at - now)))
        await pipe.execute()
    return session


async def promote(token: str) -> Session | None:
    """Turn a partial session into a full one once MFA has been verified.

    The token is kept - rotating it here would log the user out of the tab that
    is mid-flow. The privilege change is recorded on the existing session.
    """
    fp = token_fingerprint(token)
    r = get_redis()
    m = await r.hgetall(_skey(fp))
    if not m:
        return None
    now = time.time()
    expires = now + settings.session_ttl_s
    pipe = r.pipeline()
    pipe.hset(
        _skey(fp),
        mapping={
            "partial": "0",
            "mfa_verified": "1",
            "last_seen_at": str(now),
            "expires_at": str(expires),
        },
    )
    pipe.expire(_skey(fp), settings.session_ttl_s)
    await pipe.execute()
    m |= {"partial": "0", "mfa_verified": "1", "last_seen_at": str(now), "expires_at": str(expires)}
    log.info("session.promoted", sid=m["sid"], user_id=m["user_id"])
    return _from_mapping(m)


async def destroy(token: str) -> None:
    fp = token_fingerprint(token)
    r = get_redis()
    m = await r.hgetall(_skey(fp))
    pipe = r.pipeline()
    pipe.delete(_skey(fp))
    if m:
        pipe.srem(_ukey(int(m["user_id"])), fp)
    await pipe.execute()


async def list_for_user(user_id: int) -> list[Session]:
    """Live sessions for one user, pruning index entries whose hash has expired."""
    r = get_redis()
    fps = await r.smembers(_ukey(user_id))
    if not fps:
        return []

    pipe = r.pipeline()
    for fp in fps:
        pipe.hgetall(_skey(fp))
    results = await pipe.execute()

    sessions: list[Session] = []
    stale: list[str] = []
    for fp, m in zip(fps, results, strict=True):
        if m:
            sessions.append(_from_mapping(m))
        else:
            stale.append(fp)
    if stale:
        await r.srem(_ukey(user_id), *stale)

    sessions.sort(key=lambda s: s.last_seen_at, reverse=True)
    return sessions


async def revoke_by_sid(user_id: int, sid: str) -> bool:
    """Revoke one named session belonging to this user.

    Scoped to the owner deliberately: a session id is a bare uuid, and without
    the ownership predicate knowing one would be enough to sign anybody out.
    """
    r = get_redis()
    for fp in await r.smembers(_ukey(user_id)):
        m = await r.hgetall(_skey(fp))
        if m and m.get("sid") == sid:
            pipe = r.pipeline()
            pipe.delete(_skey(fp))
            pipe.srem(_ukey(user_id), fp)
            await pipe.execute()
            log.info("session.revoked", user_id=user_id, sid=sid)
            return True
    return False


async def revoke_all(user_id: int) -> int:
    """Terminate every session for a user - immediately.

    Called by deactivate and by force-logout. "Immediately" is the requirement:
    a deactivation that leaves a live session open has not deactivated anything.
    """
    r = get_redis()
    fps = await r.smembers(_ukey(user_id))
    if not fps:
        return 0
    pipe = r.pipeline()
    for fp in fps:
        pipe.delete(_skey(fp))
    pipe.delete(_ukey(user_id))
    await pipe.execute()
    log.info("session.revoked_all", user_id=user_id, count=len(fps))
    return len(fps)
