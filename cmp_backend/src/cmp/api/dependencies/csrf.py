"""Double-submit CSRF.

The session cookie is HttpOnly, so the browser attaches it to *any* request to
this origin — including one triggered by a form on a site the user did not
expect to be acting on their behalf. That is the whole of CSRF.

The defence is a second token that arrives two ways: as a readable cookie, and
as a header the page had to set deliberately. A cross-site attacker can cause
the cookie to be sent but cannot read it to copy into the header, because the
same-origin policy stops them.

Two decisions worth stating:

* **Checked on unsafe verbs only.** Requiring it on GET breaks every link a
  browser can follow, and a GET that changes state is a bug this would only
  paper over.
* **Compared in constant time.** A comparison that returns early on the first
  differing byte leaks the token one byte at a time to anyone patient enough.
"""

from __future__ import annotations

from fastapi import Request

from cmp.core.config import settings
from cmp.core.errors import Forbidden
from cmp.core.security import csrf_matches

#: GET and HEAD are safe by definition; OPTIONS is the preflight. Everything
#: that can change state is checked.
UNSAFE_METHODS = frozenset({"POST", "PUT", "PATCH", "DELETE"})


def verify_csrf(request: Request, expected: str) -> None:
    """Refuse a state-changing request that did not prove same-origin.

    `expected` is the token stored on the session, not the one in the cookie —
    comparing the cookie against the header would pass for an attacker who could
    set both, which is precisely the position a subdomain takeover puts them in.
    """
    if request.method not in UNSAFE_METHODS:
        return

    supplied = request.headers.get(settings.csrf_header_name, "")
    if not csrf_matches(expected, supplied):
        raise Forbidden("CSRF check failed. Reload the page and try again.")
