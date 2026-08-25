"""Rate limiting, account lockout and distributed locks.

Redis-backed, because all three have to hold across processes. A per-process
counter is not a rate limit when there are four workers.

Lockout is keyed on the *account*, not the address: an attacker rotates
addresses, and a legitimate user behind a corporate NAT should not be locked out
because a colleague mistyped their password.
"""

from cmp.auth.rate_limit.service import (
    check,
    clear_login_failures,
    enforce,
    is_locked_out,
    lock,
    record_login_failure,
)

__all__ = [
    "check",
    "clear_login_failures",
    "enforce",
    "is_locked_out",
    "lock",
    "record_login_failure",
]
