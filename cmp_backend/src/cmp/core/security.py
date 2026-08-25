"""Password hashing, capability tokens, OTP, CSRF and content hashing.

Rules this module exists to keep in one place:

* Passwords are Argon2id. Never MD5/SHA/bcrypt-with-a-short-cost, never reversible.
* Every token handed to a browser is CSPRNG, >= 32 bytes, base64url, and is
  compared in constant time.
* Tokens are stored **hashed**. A leaked session store must not yield live
  credentials, and a consent link token in a database dump must not be replayable.
* `content_hash` is the notice-integrity primitive. It is sha256 over the exact
  bytes served, computed once at publication and copied into the artefact.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import secrets
from typing import Final

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerifyMismatchError
from argon2.low_level import Type

from cmp.core.config import settings

# OWASP 2024 second-choice profile: 19 MiB, t=2, p=1.
_hasher: Final = PasswordHasher(
    time_cost=2,
    memory_cost=19 * 1024,
    parallelism=1,
    hash_len=32,
    salt_len=16,
    type=Type.ID,
)

TOKEN_BYTES: Final = 32  # consent links: >= 32 bytes, per DATA-MODEL
OTP_ALPHABET: Final = "0123456789"


# ------------------------------------------------------------------ passwords
def hash_password(plain: str) -> str:
    return _hasher.hash(plain)


def verify_password(plain: str, stored_hash: str | None) -> bool:
    """Constant-ish time verify.

    A user with no password (`password_hash IS NULL` — data subjects are
    passwordless) still burns a hash so that account existence cannot be timed.
    """
    if not stored_hash:
        _hasher.hash(plain)  # dummy work, result discarded
        return False
    try:
        return _hasher.verify(stored_hash, plain)
    except (VerifyMismatchError, InvalidHashError):
        return False


def password_needs_rehash(stored_hash: str) -> bool:
    try:
        return _hasher.check_needs_rehash(stored_hash)
    except InvalidHashError:
        return True


# --------------------------------------------------------------------- tokens
def new_token(nbytes: int = TOKEN_BYTES) -> str:
    """URL-safe CSPRNG token. This is the value that travels; it is never stored."""
    return base64.urlsafe_b64encode(secrets.token_bytes(nbytes)).rstrip(b"=").decode("ascii")


def token_fingerprint(token: str) -> str:
    """Keyed digest of a token — this is what goes in the database or Redis.

    Keyed (HMAC) rather than bare sha256: a stolen table of digests cannot be
    attacked offline without also stealing the application secret.
    """
    key = settings.secret_key.get_secret_value().encode("utf-8")
    return hmac.new(key, token.encode("utf-8"), hashlib.sha256).hexdigest()


def tokens_equal(a: str, b: str) -> bool:
    return hmac.compare_digest(a, b)


# ------------------------------------------------------------------------ OTP
def new_otp(length: int | None = None) -> str:
    n = length or settings.otp_length
    return "".join(secrets.choice(OTP_ALPHABET) for _ in range(n))


def hash_otp(code: str, *, scope: str) -> str:
    """Scope binds a code to one purpose — a login code cannot verify a consent link."""
    key = settings.secret_key.get_secret_value().encode("utf-8")
    return hmac.new(key, f"{scope}:{code}".encode(), hashlib.sha256).hexdigest()


# ----------------------------------------------------------------------- CSRF
def new_csrf_token() -> str:
    return new_token(32)


def csrf_matches(cookie_value: str | None, header_value: str | None) -> bool:
    """Double-submit: the header must reproduce the cookie.

    Cookies ride along automatically; a header does not. An attacker's page can
    cause the cookie to be sent but cannot read it to set the header.
    """
    if not cookie_value or not header_value:
        return False
    return hmac.compare_digest(cookie_value, header_value)


# ------------------------------------------------------------------- content
def content_hash(text: str) -> str:
    """sha256 of the exact rendered notice text. INV-4 depends on this being stable."""
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def file_hash(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def stream_hash(chunks: object) -> str:  # pragma: no cover - helper for large uploads
    digest = hashlib.sha256()
    for chunk in chunks:  # type: ignore[attr-defined]
        digest.update(chunk)
    return digest.hexdigest()


def chain_hash(prev_hash: str | None, payload: str) -> str:
    """Audit hash chain: H(prev || payload). Tampering with row N invalidates N+1..∞."""
    return hashlib.sha256(f"{prev_hash or ''}|{payload}".encode()).hexdigest()
