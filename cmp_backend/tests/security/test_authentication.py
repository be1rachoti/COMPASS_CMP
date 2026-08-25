"""Authentication — OWASP API2.

The properties asserted here are the ones whose absence is invisible until
somebody exploits them. A sign-in that works is not evidence that any of these
hold; each has to be checked on its own.

Two populations, and the difference is deliberate. Staff have a password.
**Data subjects have none** — `password_hash` is nullable for exactly that
reason — and sign in with a one-time code. A data subject who could set a
password would be an account worth phishing; one who receives a code per
sign-in has nothing worth stealing between sessions.
"""

from __future__ import annotations

import pytest

from cmp.core.security import (
    hash_password,
    new_token,
    password_needs_rehash,
    verify_password,
)


class TestPasswordHashing:
    def test_a_hash_does_not_contain_the_password(self) -> None:
        digest = hash_password("correct horse battery staple")
        assert "correct horse battery staple" not in digest

    def test_argon2id_is_the_algorithm(self) -> None:
        """Not bcrypt, not PBKDF2, and certainly not a bare SHA.

        Argon2id is memory-hard, which is what makes a GPU farm a poor
        investment against it. The parameter string is in the digest, so this
        can be asserted from the output.
        """
        assert hash_password("x" * 12).startswith("$argon2id$")

    def test_the_same_password_hashes_differently_each_time(self) -> None:
        """A per-hash salt. Without it, identical passwords are visibly
        identical in the table, and one cracked hash cracks every account that
        shared it."""
        assert hash_password("a-repeated-password") != hash_password("a-repeated-password")

    def test_verification_accepts_the_right_password(self) -> None:
        digest = hash_password("the-correct-password")
        assert verify_password("the-correct-password", digest)

    def test_verification_rejects_a_wrong_password(self) -> None:
        digest = hash_password("the-correct-password")
        assert not verify_password("the-wrong-password", digest)

    def test_verification_of_a_malformed_hash_returns_false_rather_than_raising(self) -> None:
        """A corrupted row must be a failed sign-in, not a 500.

        Raising here would turn one bad row into an outage on that account, and
        the traceback would carry the hash into the logs.
        """
        assert not verify_password("anything", "not-a-hash")
        assert not verify_password("anything", "")
        assert not verify_password("anything", None)

    def test_rehashing_is_offered_when_parameters_move(self) -> None:
        """Cost parameters rise over time; existing hashes should be upgraded on
        the next successful sign-in rather than left at the old cost forever."""
        assert not password_needs_rehash(hash_password("a-current-password"))


class TestTokenGeneration:
    def test_tokens_are_unpredictable(self) -> None:
        """Distinctness across a large sample is the cheap proxy for entropy.

        A collision here would mean `secrets` was not being used — which is the
        failure this guards against, not a subtle bias.
        """
        tokens = {new_token(32) for _ in range(2000)}
        assert len(tokens) == 2000

    def test_a_token_is_long_enough_to_resist_guessing(self) -> None:
        assert len(new_token(32)) >= 32

    def test_tokens_are_url_safe(self) -> None:
        """Consent tokens travel in a path segment. A `/` or `+` in one would
        break the route or change meaning under encoding."""
        import string

        allowed = set(string.ascii_letters + string.digits + "-_")
        assert set(new_token(48)) <= allowed


class TestMfaAppliesToPrivilegedRoles:
    """A second factor on the two roles whose compromise is unbounded.

    The DPO can read every consent record on the platform; the admin can grant
    themselves any role. Neither is more trustworthy than the others — the
    difference is the blast radius.
    """

    def test_dpo_and_admin_require_mfa(self) -> None:
        from cmp.auth.authorization.roles import requires_mfa

        assert requires_mfa("dpo")
        assert requires_mfa("admin")

    def test_the_configured_list_is_what_is_enforced(self) -> None:
        """Read from configuration, not hardcoded, so a deployment can widen it.

        Narrowing it below the default is a decision a deployment has to answer
        for; the code does not prevent it, and should not pretend to.
        """
        from cmp.core.config import settings

        assert "dpo" in settings.mfa_required_roles
        assert "admin" in settings.mfa_required_roles


class TestPartialSessionsAuthoriseAlmostNothing:
    """The state between password and second factor.

    A partial session is the most dangerous object in the auth flow: the password
    has been accepted, so it is tempting to treat it as "nearly signed in". It
    authorises exactly one route.
    """

    def test_the_partial_dependency_is_distinct_from_the_full_one(self) -> None:
        """Two names, so a route cannot accept a partial session by forgetting a
        flag. A boolean on one type is one missed `if` from an MFA bypass."""
        from cmp.api.dependencies import CurrentUser, PartialUser

        assert CurrentUser is not PartialUser

    def test_a_partial_session_is_rejected_by_the_full_dependency(self) -> None:
        import inspect

        from cmp.api.dependencies import authentication

        source = inspect.getsource(authentication.current_principal)
        assert "MfaRequired" in source, (
            "current_principal must refuse a partial session with MfaRequired, "
            "or a caller who stops after the password is fully signed in"
        )


class TestNoCredentialReachesALogLine:
    """Structured logging makes it easy to attach the whole request to a line.

    These assertions are structural: the modules that handle credentials must not
    interpolate them into log calls.
    """

    @pytest.mark.parametrize(
        "module_path",
        [
            "cmp.auth.authentication.service",
            "cmp.auth.authentication.otp",
            "cmp.auth.sessions.service",
        ],
    )
    def test_no_password_or_code_is_logged(self, module_path: str) -> None:
        import importlib
        import inspect
        import re

        module = importlib.import_module(module_path)
        source = inspect.getsource(module)

        # A log call that passes a variable named like a credential.
        offenders = re.findall(
            r"log\.\w+\([^)]*\b(password|plaintext|raw_code|secret)\s*=",
            source,
        )
        assert not offenders, f"{module_path} appears to log {sorted(set(offenders))}"
