"""Authorisation: may this role do this, and to which rows.

Two questions, deliberately answered by different things:

* **May this role call this at all?** `permissions.MATRIX`, checked by
  `evaluator.evaluate` before any work is done.
* **Which rows may this user see?** A `Scope`, which a repository turns into a
  WHERE predicate. Never a filter applied after the fetch — a row that is
  already in the response has already leaked.

Callers use `policy.authorize()`. It answers both questions from one grant and
logs the denial, so an access-control decision cannot be made without leaving a
trace of it.

The modules underneath are split by what they hold rather than by who calls
them: `roles` (who someone may be), `resources` (what a permission is about),
`permissions` (the matrix), `scopes` (how far), `evaluator` (deciding),
`policy` (the front door), `guards` (the FastAPI wiring).
"""

from cmp.auth.authorization.evaluator import (
    Decision,
    can_read,
    can_write,
    evaluate,
    grant_for,
    nav_for,
    readable_resources,
    scope_of,
    writable_resources,
)
from cmp.auth.authorization.permissions import verify_resources
from cmp.auth.authorization.policy import authorize, require_role
from cmp.auth.authorization.roles import (
    FIDUCIARY_ROLES,
    PRIVILEGED_ROLES,
    STAFF_ROLES,
    is_privileged,
    is_staff,
    requires_mfa,
)
from cmp.auth.authorization.scopes import ScopeContext, describe, narrower_of
from cmp.core.permissions import MATRIX, NAV_BY_ROLE

__all__ = [
    "FIDUCIARY_ROLES",
    "MATRIX",
    "NAV_BY_ROLE",
    "PRIVILEGED_ROLES",
    "STAFF_ROLES",
    "Decision",
    "ScopeContext",
    "authorize",
    "can_read",
    "can_write",
    "describe",
    "evaluate",
    "grant_for",
    "is_privileged",
    "is_staff",
    "narrower_of",
    "nav_for",
    "readable_resources",
    "require_role",
    "requires_mfa",
    "scope_of",
    "verify_resources",
    "writable_resources",
]
