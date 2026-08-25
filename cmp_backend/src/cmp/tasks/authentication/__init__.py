"""Delivering one-time codes.

Four tasks, all on `high_priority`, all required rather than optional. A person
is waiting for each of these with a code box open.
"""

from cmp.tasks.authentication.otp import (
    send_consent_code,
    send_login_code,
    send_mfa_code,
    send_password_reset,
)

__all__ = [
    "send_consent_code",
    "send_login_code",
    "send_mfa_code",
    "send_password_reset",
]
