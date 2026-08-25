# CSRF

## The problem

The session cookie is HttpOnly, which is right — script cannot read it. The cost
is that the browser attaches it to **any** request to this origin, including one
triggered by a form on a site the user did not expect to be acting on their
behalf.

## The defence

Double-submit. A second token arrives two ways:

* as a cookie the page **can** read (`cmp_csrf`, not HttpOnly);
* as a header the page had to set deliberately (`X-CSRF-Token`).

A cross-site attacker can cause the cookie to be sent — that is the whole problem
— but cannot read it to copy into the header, because the same-origin policy
stops them.

## Two decisions

**Checked on unsafe verbs only** — POST, PUT, PATCH, DELETE. Requiring a header
on GET breaks every link a browser can follow, and a GET that changes state is a
bug this would only paper over.

**Compared against the session's stored token**, not against the cookie.
Comparing cookie to header would pass for an attacker who could set both, which
is exactly the position a subdomain takeover puts them in.

## Constant time

`hmac.compare_digest`. A comparison that returns early on the first differing
byte leaks the token one byte at a time to anyone patient enough.

## Failing closed

An absent, empty or whitespace-only header fails. This is the case a naive
`stored == supplied` gets wrong: both are empty for a request with no header at
all, and an equality check passes.

`tests/security/test_csrf.py` asserts each of these, including the empty case.
