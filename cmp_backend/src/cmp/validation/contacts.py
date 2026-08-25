"""Contact types.

A data subject is reached by email or mobile, and both are how they sign in —
there is no password on a data subject account. That makes these the identifiers
of a person as much as a way to contact them.
"""

from __future__ import annotations

from typing import Annotated

from pydantic import EmailStr, StringConstraints

#: Validated by `email-validator`, which checks the domain's syntax rather than
#: guessing at a regex. Length is bounded by the RFC and by the column.
Email = Annotated[EmailStr, StringConstraints(max_length=255)]

#: Deliberately permissive: this system operates in India and receives numbers
#: written with a country code, spaces or dashes. Normalising aggressively would
#: reject numbers people actually have, and a number we cannot reach is worse
#: than a number stored with a space in it.
Mobile = Annotated[str, StringConstraints(min_length=6, max_length=20, pattern=r"^\+?[0-9 \-]+$")]

#: Either of the above, for the sign-in form that accepts both.
Contact = Annotated[str, StringConstraints(min_length=3, max_length=255)]
