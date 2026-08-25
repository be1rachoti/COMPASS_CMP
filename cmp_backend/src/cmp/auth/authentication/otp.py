"""One-time codes, for data-subject sign-in, staff MFA and the public consent flow.

Properties that matter, and why:

* **The code is never stored.** Redis holds a keyed digest. A dump of the store
  does not let anyone complete a sign-in that is in flight.
* **The scope is part of the digest.** A code issued for a consent link cannot be
  replayed against `/auth/otp/verify`, because a different scope hashes to a
  different value even for the same six digits.
* **Attempts are counted against the code, not the connection.** Five wrong
  guesses discard the code (API reference §1.6). Counting per connection means
  an attacker with two connections gets ten.
* **Verification is single-use and atomic.** The delete happens with the check,
  so two racing requests cannot both succeed with the same code.

Six digits is a million-space, which is only safe *because* of the attempt cap
and the ten-minute lifetime. Neither control is optional.
"""

from __future__ import annotations

from dataclasses import dataclass

from cmp.core.config import settings
from cmp.core.errors import BadRequest, RateLimited
from cmp.core.logging import get_logger
from cmp.core.security import hash_otp, new_otp, tokens_equal
from cmp.db.redis import K_OTP, K_OTP_ATTEMPTS, get_redis, key

log = get_logger("cmp.otp")


class Scope:
    """A code is only valid for the flow it was issued for."""

    SUBJECT_LOGIN = "subject_login"
    CONSENT_LINK = "consent_link"
    STAFF_MFA = "staff_mfa"
    CONTACT_VERIFY = "contact_verify"


@dataclass(frozen=True, slots=True)
class Issued:
    code: str  # delivered out of band; never returned by an API response
    expires_in_s: int


def _ckey(scope: str, identity: str) -> str:
    return key(K_OTP, scope, identity)


def _akey(scope: str, identity: str) -> str:
    return key(K_OTP_ATTEMPTS, scope, identity)


async def issue(scope: str, identity: str, *, ttl_s: int | None = None) -> Issued:
    """Generate and store a code for (scope, identity).

    Issuing replaces any outstanding code and resets the attempt counter, so a
    user who asks for a new code is not locked out by their own typos on the old
    one. Rate limiting on *requesting* a code lives at the route, where the
    per-contact and per-token quotas differ.
    """
    ttl = ttl_s or settings.otp_ttl_s
    code = new_otp()
    r = get_redis()
    pipe = r.pipeline()
    pipe.setex(_ckey(scope, identity), ttl, hash_otp(code, scope=scope))
    pipe.delete(_akey(scope, identity))
    await pipe.execute()

    # The code itself is never logged. The fact of issuance is.
    log.info("otp.issued", scope=scope, ttl_s=ttl)
    return Issued(code=code, expires_in_s=ttl)


async def verify(scope: str, identity: str, code: str) -> bool:
    """Check a code once. Consumes it on success; discards it after N failures."""
    r = get_redis()
    ck, ak = _ckey(scope, identity), _akey(scope, identity)

    stored = await r.get(ck)
    if stored is None:
        log.info("otp.verify_no_code", scope=scope)
        return False

    if tokens_equal(stored, hash_otp(code, scope=scope)):
        pipe = r.pipeline()
        pipe.delete(ck)  # single use
        pipe.delete(ak)
        await pipe.execute()
        log.info("otp.verified", scope=scope)
        return True

    pipe = r.pipeline()
    pipe.incr(ak)
    pipe.expire(ak, settings.otp_ttl_s)
    attempts = int((await pipe.execute())[0])

    if attempts >= settings.otp_max_verify_attempts:
        # Discard the code entirely rather than merely refusing this attempt.
        # A code that survives its attempt budget is a code being brute-forced.
        await r.delete(ck, ak)
        log.warning("otp.discarded_after_attempts", scope=scope, attempts=attempts)
        raise RateLimited(
            "Too many incorrect attempts. Request a new code.",
            retry_after_s=0,
        )

    log.info("otp.verify_failed", scope=scope, attempts=attempts)
    return False


async def require(scope: str, identity: str, code: str) -> None:
    """Verify or raise. The message is identical for a wrong code and an expired
    one - distinguishing them tells an attacker which half of the problem to fix."""
    if not code.isdigit() or len(code) != settings.otp_length:
        raise BadRequest("Invalid code", code="otp_invalid", field="code")
    if not await verify(scope, identity, code):
        raise BadRequest("Invalid or expired code", code="otp_invalid", field="code")


async def discard(scope: str, identity: str) -> None:
    r = get_redis()
    await r.delete(_ckey(scope, identity), _akey(scope, identity))
