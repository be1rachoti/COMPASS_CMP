"""Who the caller is.

`Principal` is the answer, resolved once per request by the API layer and passed
down. Identity is separate from authorisation on purpose: this package says who
somebody is, `authorization/` says what that lets them do.
"""

from cmp.auth.identity.principal import Principal

__all__ = ["Principal"]
