"""Guard rails over the permission table.

The table itself lives in `cmp.core.permissions`, because it is static data with
no dependencies and the repositories need to read a scope out of it without
importing the layer above them.

This module is what makes that table trustworthy:

* it names every resource as a constant, so a route says
  `RequireResource(resources.PROJECT)` and a typo is an `AttributeError` at
  import rather than a permanent silent 403 in production;
* it asserts at import that the roster and the table agree in both directions;
* it re-exports the table so authorisation code has one obvious place to import
  from, and a reader following `authorize()` downwards does not have to jump
  layers to find what it consulted.
"""

from __future__ import annotations

from cmp.auth.authorization import resources
from cmp.core.permissions import MATRIX, NAV_BY_ROLE, Grant, Role, Scope

__all__ = ["MATRIX", "NAV_BY_ROLE", "Grant", "Role", "Scope", "verify_resources"]


def verify_resources() -> None:
    """Assert that the resource roster and the permission table agree.

    Runs at import, so a mismatch is a process that will not start rather than
    an endpoint that quietly refuses everyone. Both directions matter:

    * A resource in the table but not the roster means somebody added a rule for
      a name no route can use — the rule is dead and nobody will notice.
    * A resource in the roster but not the table is denied to every role,
      because an absent row is a denial. That may even be intended, but it has
      to be *said*, not left as an omission that reads identically to a
      forgotten line.
    """
    unknown = sorted(set(MATRIX) - resources.ALL)
    if unknown:
        raise RuntimeError(
            f"core.permissions.MATRIX grants on resource(s) {unknown}, which are not "
            "named in auth.authorization.resources.ALL. Add the constant, or remove "
            "the rule."
        )

    ungoverned = sorted(resources.ALL - set(MATRIX))
    if ungoverned:
        raise RuntimeError(
            f"Resource(s) {ungoverned} are named in resources.ALL but have no row in "
            "MATRIX. An absent row denies every role — if that is intended, write it "
            "as an empty row so the intent is visible."
        )


verify_resources()
