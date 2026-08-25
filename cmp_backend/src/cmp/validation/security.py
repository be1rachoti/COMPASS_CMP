"""Types for values that are credentials.

Kept apart from the other primitives because the rules differ: these are never
logged, never echoed back in an error message, and never compared with `==`.

The bounds here are a denial-of-service control as much as a validation rule.
Argon2 is deliberately expensive; hashing an unbounded password is a way to make
the server do unbounded work per request. 128 characters is well past any real
passphrase and far short of a problem.
"""

from __future__ import annotations

from typing import Annotated

from pydantic import StringConstraints

#: Minimum 12 characters. Length beats composition rules: a 12-character
#: passphrase resists guessing better than "P@ss1!" and people can remember it,
#: so they do not write it on a card.
Password = Annotated[str, StringConstraints(min_length=12, max_length=128)]

#: A one-time code. Digits only, so a code entry box can be numeric on a phone.
OtpCode = Annotated[str, StringConstraints(min_length=4, max_length=10, pattern=r"^[0-9]+$")]

#: A single-use token from a password-reset email.
ResetToken = Annotated[
    str, StringConstraints(min_length=16, max_length=256, pattern=r"^[A-Za-z0-9_.\-]+$")
]

#: A SHA-256 digest as lowercase hex. Used for notice content hashes and file
#: hashes, both of which are compared character by character.
Sha256Hex = Annotated[str, StringConstraints(pattern=r"^[a-f0-9]{64}$")]
