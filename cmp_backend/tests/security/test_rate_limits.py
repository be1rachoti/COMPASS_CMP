"""Rate limiting and account lockout.

Three surfaces need bounding, for three different reasons:

* **Sign-in.** Unbounded attempts is password guessing at leisure. Bounded on the
  *account* rather than the address, because an attacker rotates addresses and a
  legitimate user behind a corporate NAT should not be locked out by a
  colleague's typo.
* **One-time codes.** A six-digit code is a million possibilities, which is a lot
  for a human and not many for a script. The verify attempt cap is what makes the
  code strong enough; the request cap is what stops the SMS bill being somebody
  else's problem.
* **The public consent link.** Unauthenticated and enumerable in principle. Bounded
  per address, because there is no account to bound on.

All three are Redis-backed rather than per-process. A counter in process memory
is not a rate limit when there are four workers — it is a limit four times looser
than it claims, and nobody notices until the fifth worker is added.
"""

from __future__ import annotations

import pytest

from cmp.core.config import settings

pytestmark = pytest.mark.integration


class TestConfiguredBounds:
    """The numbers themselves. Cheap to assert, and they have drifted before."""

    def test_sign_in_attempts_are_bounded(self) -> None:
        assert 0 < settings.login_max_attempts <= 10, (
            "more than ten attempts is not a meaningful bound on guessing"
        )

    def test_a_lockout_actually_lasts(self) -> None:
        assert settings.login_lockout_duration_s >= 300, (
            "a lockout shorter than five minutes barely slows a script down"
        )

    def test_otp_verification_is_bounded(self) -> None:
        """The cap is what makes six digits strong enough.

        Unbounded, a million guesses is minutes of scripted work. Bounded at
        five, it is a one-in-two-hundred-thousand chance per issued code.
        """
        assert 0 < settings.otp_max_verify_attempts <= 10

    def test_code_requests_are_bounded_per_contact(self) -> None:
        """Otherwise the form is an SMS pump aimed at somebody else's number."""
        assert 0 < settings.otp_requests_per_contact_per_hour <= 20

    def test_a_code_expires_quickly(self) -> None:
        assert 60 <= settings.otp_ttl_s <= 900, (
            "a code valid for hours is a credential sitting in an inbox"
        )

    def test_the_public_link_is_rate_limited(self) -> None:
        assert 0 < settings.public_link_rate_per_minute <= 300

    def test_sessions_expire_both_ways(self) -> None:
        """An absolute lifetime and an idle timeout do different jobs.

        Idle alone means a session used once an hour lives forever. Absolute
        alone means an abandoned browser stays signed in all day.
        """
        assert settings.session_idle_timeout_s < settings.session_ttl_s
        assert settings.session_ttl_s <= 24 * 60 * 60


class TestLockoutBehaviour:
    """The mechanism, against a live Redis."""

    async def test_repeated_failures_lock_the_account(self, redis_conn: object) -> None:
        from cmp.auth.rate_limit import service as rate_limit

        account = "lockout-test-account"
        await rate_limit.clear_login_failures(account)

        assert not await rate_limit.is_locked_out(account)

        for _ in range(settings.login_max_attempts):
            await rate_limit.record_login_failure(account)

        assert await rate_limit.is_locked_out(account), (
            "the account should be locked after the configured number of failures"
        )

        await rate_limit.clear_login_failures(account)

    async def test_a_successful_sign_in_clears_the_counter(self, redis_conn: object) -> None:
        """Otherwise a user who mistypes twice a day is locked out by Thursday."""
        from cmp.auth.rate_limit import service as rate_limit

        account = "lockout-clear-test"
        await rate_limit.clear_login_failures(account)

        for _ in range(settings.login_max_attempts - 1):
            await rate_limit.record_login_failure(account)
        await rate_limit.clear_login_failures(account)

        for _ in range(settings.login_max_attempts - 1):
            await rate_limit.record_login_failure(account)

        assert not await rate_limit.is_locked_out(account)
        await rate_limit.clear_login_failures(account)

    async def test_locking_one_account_does_not_lock_another(
        self, redis_conn: object
    ) -> None:
        """The keying, asserted. A shared key would be a denial-of-service on
        every user the moment one account was targeted."""
        from cmp.auth.rate_limit import service as rate_limit

        targeted, bystander = "targeted-account", "bystander-account"
        await rate_limit.clear_login_failures(targeted)
        await rate_limit.clear_login_failures(bystander)

        for _ in range(settings.login_max_attempts):
            await rate_limit.record_login_failure(targeted)

        assert await rate_limit.is_locked_out(targeted)
        assert not await rate_limit.is_locked_out(bystander)

        await rate_limit.clear_login_failures(targeted)


class TestOtpIsNotStoredInPlaintext:
    """A code readable from Redis is a code an operator can use.

    Stored as a keyed hash for the same reason passwords are: whoever can read
    the store should not thereby be able to complete somebody else's sign-in.
    """

    async def test_the_issued_code_is_not_recoverable_from_the_store(
        self, redis_conn: object
    ) -> None:
        from cmp.auth.authentication import otp
        from cmp.db.redis import get_redis

        issued = await otp.issue(otp.Scope.STAFF_MFA, "otp-storage-test", ttl_s=60)

        redis = get_redis()
        keys = [k async for k in redis.scan_iter(match="*otp-storage-test*")]
        assert keys, "expected the code to be stored under some key"

        for key in keys:
            stored = await redis.get(key)
            if stored is None:
                continue
            text = stored.decode() if isinstance(stored, bytes) else str(stored)
            assert issued.code not in text, (
                "the one-time code is recoverable from Redis in plaintext"
            )

        await otp.discard(otp.Scope.STAFF_MFA, "otp-storage-test")
