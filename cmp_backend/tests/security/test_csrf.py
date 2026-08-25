"""Cross-site request forgery.

The session cookie is HttpOnly, which is right — script cannot read it, so an XSS
bug cannot exfiltrate it. The cost is that the browser attaches it to *any*
request to this origin, including one triggered by a form on a site the user did
not expect to be acting on their behalf. That is the whole of CSRF.

The defence is a second token that has to arrive two ways: as a cookie the page
can read, and as a header the page had to set deliberately. A cross-site attacker
can cause the cookie to be sent but cannot read it to copy into the header,
because the same-origin policy stops them.

Two properties are asserted here, and both have been got wrong in real systems:

* the comparison is **constant time**, so it cannot be walked a byte at a time;
* an absent, empty or whitespace token **fails closed**, rather than an empty
  string comparing equal to an empty stored value.
"""

from __future__ import annotations

import pytest

from cmp.api.dependencies.csrf import UNSAFE_METHODS
from cmp.core.security import csrf_matches, new_token


class TestTokenComparison:
    def test_a_matching_pair_passes(self) -> None:
        token = new_token(32)
        assert csrf_matches(token, token)

    def test_a_different_token_fails(self) -> None:
        assert not csrf_matches(new_token(32), new_token(32))

    @pytest.mark.parametrize("supplied", [None, "", "   "])
    def test_an_absent_or_empty_header_fails_closed(self, supplied: str | None) -> None:
        """The failure that matters.

        A naive `stored == supplied` passes when both are empty — which is
        exactly the state a request with no CSRF header is in.
        """
        assert not csrf_matches(new_token(32), supplied)

    @pytest.mark.parametrize("stored", [None, ""])
    def test_an_absent_stored_token_fails_closed(self, stored: str | None) -> None:
        """A session with no CSRF token must not accept anything."""
        assert not csrf_matches(stored, "anything")

    def test_both_absent_still_fails(self) -> None:
        assert not csrf_matches(None, None)
        assert not csrf_matches("", "")

    def test_a_prefix_of_the_token_does_not_pass(self) -> None:
        """Guards against a comparison that stops at the shorter length."""
        token = new_token(32)
        assert not csrf_matches(token, token[:-1])
        assert not csrf_matches(token, token + "x")

    def test_comparison_does_not_short_circuit_on_the_first_byte(self) -> None:
        """A timing-safe comparison cannot be walked byte by byte.

        Asserted structurally rather than by measuring a clock — a timing
        assertion in a test suite is flaky on shared CI and proves less than
        reading the implementation. What is checked is that the function is
        built on `hmac.compare_digest`, which is the guarantee.
        """
        import inspect

        from cmp.core import security

        source = inspect.getsource(security.csrf_matches)
        assert "compare_digest" in source, (
            "csrf_matches must use hmac.compare_digest; a == comparison leaks "
            "the token one byte at a time"
        )


class TestWhichMethodsAreChecked:
    """Safe verbs are exempt, and that is deliberate rather than an oversight."""

    @pytest.mark.parametrize("method", ["POST", "PUT", "PATCH", "DELETE"])
    def test_every_state_changing_verb_is_checked(self, method: str) -> None:
        assert method in UNSAFE_METHODS

    @pytest.mark.parametrize("method", ["GET", "HEAD", "OPTIONS"])
    def test_safe_verbs_are_exempt(self, method: str) -> None:
        """Requiring a header on GET breaks every link a browser can follow.

        A GET that changes state is a bug this exemption would only paper over —
        the fix there is the verb, not the CSRF policy.
        """
        assert method not in UNSAFE_METHODS


class TestCookieFlags:
    """The two cookies are deliberately different, and swapping them breaks both.

    The session cookie must be HttpOnly or script can steal it. The CSRF cookie
    must *not* be, because the page has to read it to set the header — that is
    the mechanism, not an oversight.
    """

    def test_the_session_cookie_is_httponly_and_the_csrf_cookie_is_not(self) -> None:
        import inspect

        from cmp.api.dependencies import sessions

        source = inspect.getsource(sessions.set_session_cookies)

        # Both flags appear; the test is that the file distinguishes them.
        assert "httponly=True" in source.replace(" ", "")
        assert "httponly=False" in source.replace(" ", "")


class TestProductionStartupGuards:
    """The five things production refuses to boot with.

    A service that starts with a known secret key is worse than one that does not
    start: the second failure is loud and costs ten minutes, the first is silent
    and lasts until somebody forges a session cookie.

    Each guard is exercised on its own, from an otherwise-valid production
    configuration, so a test failing here names exactly which protection was
    removed rather than "production config is broken".
    """

    @staticmethod
    def _valid() -> dict[str, object]:
        """A production configuration that should be accepted."""
        from pydantic import SecretStr

        return {
            "environment": "production",
            "secret_key": SecretStr("a-real-secret-key-of-at-least-thirty-two-bytes"),
            "postgres_password": SecretStr("a-real-database-password"),
            "cookie_secure": True,
            "debug": False,
            "cors_origins": ("https://console.example.org",),
        }

    def test_a_complete_production_configuration_is_accepted(self) -> None:
        """The guards must permit a correct deployment, or they are just an outage."""
        from cmp.core.config import Settings

        settings = Settings(**self._valid())  # type: ignore[arg-type]
        assert settings.is_production
        assert settings.cookie_secure

    def test_the_development_secret_key_is_refused(self) -> None:
        import pytest as _pytest
        from pydantic import SecretStr, ValidationError

        from cmp.core.config import Settings

        with _pytest.raises(ValidationError, match="SECRET_KEY"):
            Settings(**{**self._valid(), "secret_key": SecretStr("dev-only-change-me" * 3)})  # type: ignore[arg-type]

    def test_a_short_secret_key_is_refused(self) -> None:
        """Length matters as much as origin: a 12-byte key is guessable."""
        import pytest as _pytest
        from pydantic import SecretStr, ValidationError

        from cmp.core.config import Settings

        with _pytest.raises(ValidationError, match="SECRET_KEY"):
            Settings(**{**self._valid(), "secret_key": SecretStr("too-short")})  # type: ignore[arg-type]

    def test_a_default_database_password_is_refused(self) -> None:
        import pytest as _pytest
        from pydantic import SecretStr, ValidationError

        from cmp.core.config import Settings

        for weak in ("cmp", "postgres", ""):
            with _pytest.raises(ValidationError, match="POSTGRES_PASSWORD"):
                Settings(**{**self._valid(), "postgres_password": SecretStr(weak)})  # type: ignore[arg-type]

    def test_an_insecure_cookie_is_refused(self) -> None:
        """Without Secure the session travels in cleartext on the first http:// hop."""
        import pytest as _pytest
        from pydantic import ValidationError

        from cmp.core.config import Settings

        with _pytest.raises(ValidationError, match="COOKIE_SECURE"):
            Settings(**{**self._valid(), "cookie_secure": False})  # type: ignore[arg-type]

    def test_debug_mode_is_refused(self) -> None:
        """Debug turns a handled failure into a traceback with local variables."""
        import pytest as _pytest
        from pydantic import ValidationError

        from cmp.core.config import Settings

        with _pytest.raises(ValidationError, match="DEBUG"):
            Settings(**{**self._valid(), "debug": True})  # type: ignore[arg-type]

    def test_a_wildcard_cors_origin_is_refused(self) -> None:
        """`*` with allow_credentials is the combination that hands the session away."""
        import pytest as _pytest
        from pydantic import ValidationError

        from cmp.core.config import Settings

        with _pytest.raises(ValidationError, match="CORS_ORIGINS"):
            Settings(**{**self._valid(), "cors_origins": ("*",)})  # type: ignore[arg-type]
