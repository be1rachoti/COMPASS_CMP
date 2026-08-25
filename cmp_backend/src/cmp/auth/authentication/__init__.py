"""Proving who somebody is.

Two populations, two mechanisms, and the difference is not cosmetic:

* **Staff** sign in with a password, and the privileged roles step up with a
  second factor. `password_hash` is set for them.
* **Data subjects** have no password at all — `password_hash` is nullable for
  exactly this reason — and sign in with a one-time code sent to the contact
  they registered with.

A data subject who could set a password would be an account to phish. One who
receives a code per sign-in has nothing worth stealing between sessions.
"""

from cmp.auth.authentication.service import (
    authenticate,
    change_password,
    confirm_password_reset,
    me_payload,
    request_password_reset,
    request_subject_otp,
    resend_mfa,
    verify_mfa,
    verify_subject_otp,
)

__all__ = [
    "authenticate",
    "change_password",
    "confirm_password_reset",
    "me_payload",
    "request_password_reset",
    "request_subject_otp",
    "resend_mfa",
    "verify_mfa",
    "verify_subject_otp",
]
