"""Who someone is allowed to be.

`Role` itself lives in `cmp.core.permissions` — it is vocabulary, it depends on
nothing, and half the codebase needs it. This module is the part that has
opinions: which roles are staff, which are privileged, and which need a second
factor.

The distinction that matters most in this file is the one the DPDP Act cares
about: **role is authorisation, person type is identity.** A DPO who becomes an
ex-employee keeps her permissions until somebody changes her role. Coupling the
two would mean an HR record silently revoking access — which sounds prudent
until it happens to the only person who can publish a notice.
"""

from __future__ import annotations

from cmp.core.permissions import Role

#: Everyone who works for the fiduciary. Excludes the data subject, who is not
#: staff and whose entire surface is `/me`.
STAFF_ROLES: frozenset[Role] = frozenset(
    {Role.DPO, Role.DCO, Role.RND_USER, Role.ADMIN}
)

#: Roles that can see across every project, or provision accounts. These are the
#: two that get a second factor — not because they are more trusted, but because
#: a compromise of either is unbounded.
PRIVILEGED_ROLES: frozenset[Role] = frozenset({Role.DPO, Role.ADMIN})

#: Roles that may act on behalf of the organisation in the consent record. A
#: data subject acts for herself; these act for the fiduciary.
FIDUCIARY_ROLES: frozenset[Role] = frozenset({Role.DPO, Role.DCO})


def is_staff(role: Role | str) -> bool:
    try:
        return Role(role) in STAFF_ROLES
    except ValueError:
        return False


def is_privileged(role: Role | str) -> bool:
    try:
        return Role(role) in PRIVILEGED_ROLES
    except ValueError:
        return False


def requires_mfa(role: Role | str, *, configured: tuple[str, ...] | None = None) -> bool:
    """Whether this role must complete a second factor to hold a full session.

    Reads the configured list rather than `PRIVILEGED_ROLES` so a deployment can
    widen it — some organisations will want MFA on every staff role — without
    editing code. It can be widened, and narrowing it below the configured
    default is a deployment's decision to answer for.
    """
    from cmp.core.config import settings

    allowed = configured if configured is not None else settings.mfa_required_roles
    return str(role) in allowed
