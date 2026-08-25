"""Cryptographic primitives.

These are the functions where a subtle mistake is invisible in every manual test
and fatal in production: a hash that verifies the wrong password, a token that is
predictable, an OTP that can be replayed across flows.
"""

from __future__ import annotations

import re

import pytest

from cmp.core.security import (
    chain_hash,
    content_hash,
    csrf_matches,
    file_hash,
    hash_otp,
    hash_password,
    new_csrf_token,
    new_otp,
    new_token,
    password_needs_rehash,
    token_fingerprint,
    tokens_equal,
    verify_password,
)


class TestPasswords:
    def test_hash_is_argon2id_with_expected_cost(self) -> None:
        digest = hash_password("correct horse battery staple")
        assert digest.startswith("$argon2id$")
        # OWASP second-choice profile. If someone lowers these, the test says so.
        assert "m=19456" in digest
        assert "t=2" in digest

    def test_verify_round_trip(self) -> None:
        digest = hash_password("S3cure!passphrase")
        assert verify_password("S3cure!passphrase", digest) is True
        assert verify_password("s3cure!passphrase", digest) is False
        assert verify_password("", digest) is False

    def test_same_password_hashes_differently(self) -> None:
        """Distinct salts. Identical hashes would let anyone spot shared passwords
        by reading the table."""
        assert hash_password("same input") != hash_password("same input")

    def test_null_hash_is_rejected_not_accepted(self) -> None:
        """Data subjects are passwordless - `password_hash IS NULL`.

        A null must never be a skeleton key, and it must still burn a hash so the
        response time does not reveal that the account has no password.
        """
        assert verify_password("anything", None) is False
        assert verify_password("anything", "") is False

    def test_garbage_hash_does_not_raise(self) -> None:
        assert verify_password("x", "not-a-hash") is False
        assert password_needs_rehash("not-a-hash") is True


class TestTokens:
    def test_token_is_url_safe_and_long_enough(self) -> None:
        token = new_token()
        # 32 random bytes, base64url, unpadded.
        assert len(token) == 43
        assert re.fullmatch(r"[A-Za-z0-9_-]+", token)

    def test_tokens_are_unique(self) -> None:
        assert len({new_token() for _ in range(500)}) == 500

    def test_fingerprint_is_stable_and_one_way(self) -> None:
        token = new_token()
        assert token_fingerprint(token) == token_fingerprint(token)
        assert token not in token_fingerprint(token)
        assert len(token_fingerprint(token)) == 64  # sha256 hex

    def test_different_tokens_fingerprint_differently(self) -> None:
        assert token_fingerprint(new_token()) != token_fingerprint(new_token())

    def test_constant_time_compare(self) -> None:
        assert tokens_equal("abc", "abc") is True
        assert tokens_equal("abc", "abd") is False
        assert tokens_equal("abc", "abcd") is False


class TestOtp:
    def test_length_and_alphabet(self) -> None:
        for _ in range(50):
            code = new_otp()
            assert len(code) == 6
            assert code.isdigit()

    def test_scope_binds_a_code_to_one_flow(self) -> None:
        """A code issued for a consent link must not verify a staff sign-in."""
        code = "123456"
        assert hash_otp(code, scope="consent_link") != hash_otp(code, scope="staff_mfa")

    def test_same_code_and_scope_hash_identically(self) -> None:
        assert hash_otp("123456", scope="x") == hash_otp("123456", scope="x")

    def test_codes_are_not_sequential(self) -> None:
        codes = [new_otp() for _ in range(200)]
        assert len(set(codes)) > 150  # overwhelmingly distinct


class TestCsrf:
    def test_matching_pair_passes(self) -> None:
        token = new_csrf_token()
        assert csrf_matches(token, token) is True

    @pytest.mark.parametrize(
        ("cookie", "header"),
        [
            ("abc", "abd"),
            ("abc", None),
            (None, "abc"),
            (None, None),
            ("", ""),
            ("abc", ""),
        ],
    )
    def test_anything_else_fails(self, cookie: str | None, header: str | None) -> None:
        """Both halves must be present and equal.

        Treating two empty strings as a match would make every request from a page
        that never set the cookie pass.
        """
        assert csrf_matches(cookie, header) is False


class TestContentHash:
    def test_stable_for_identical_text(self) -> None:
        """INV-4 rests on this. If the same text hashed differently twice, a
        consent artefact could never be matched back to what was served."""
        text = "NOTICE UNDER SECTION 5\n\nWe will collect your name.\n"
        assert content_hash(text) == content_hash(text)
        assert len(content_hash(text)) == 64

    def test_whitespace_is_significant(self) -> None:
        """A trailing space is a different document, because it is different bytes."""
        assert content_hash("notice") != content_hash("notice ")
        assert content_hash("a\nb") != content_hash("a\r\nb")

    def test_unicode_is_handled(self) -> None:
        hindi = "सूचना: हम आपका नाम एकत्र करेंगे।"
        assert len(content_hash(hindi)) == 64
        assert content_hash(hindi) != content_hash(hindi + " ")

    def test_file_hash_matches_content_hash_for_same_bytes(self) -> None:
        text = "the same bytes"
        assert file_hash(text.encode("utf-8")) == content_hash(text)


class TestAuditChain:
    def test_chain_depends_on_predecessor(self) -> None:
        """Changing the predecessor changes the successor - that is the property
        that makes an edit detectable rather than merely recorded."""
        assert chain_hash("prev-a", "payload") != chain_hash("prev-b", "payload")

    def test_chain_depends_on_payload(self) -> None:
        assert chain_hash("prev", "payload-a") != chain_hash("prev", "payload-b")

    def test_first_link_accepts_no_predecessor(self) -> None:
        assert len(chain_hash(None, "genesis")) == 64
        assert chain_hash(None, "genesis") == chain_hash("", "genesis")
