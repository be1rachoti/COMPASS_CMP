"""The authorisation vocabulary and the permission table.

Two things live here and nothing else: the types that name an authorisation
concept, and the static table mapping resource x role -> grant.

Both are *data*. There is no evaluation with side effects in this module - no
raising, no logging, no audit row. Those belong to `cmp.auth.authorization`,
which imports from here.

The split is what keeps the dependency graph acyclic, and it is not cosmetic.
Half the codebase needs to name a `Role`: a repository takes one to build its
scope predicate, the state machine takes one to decide a transition, a response
model serialises one. None of them should have to import the authorisation
package - which sits *above* them - to do it. `core` depends on nothing local,
so anything may depend on `core`.

`role` is authorisation and `person_type` is identity (DATA-MODEL, Identity).
Nothing here reads person_type: a DPO who becomes an ex-employee keeps her
permissions until somebody changes her role.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum


class Role(StrEnum):
    """The seven roles. Values match the `user_role` PostgreSQL enum exactly.

    Two of them exist because collection has two shapes:

    * **`DCO_ADMIN`** routes a project collected by an external processor. They
      assign its data sources, and each source's owner picks it up. They hold a
      DCO's powers across every such project rather than over their own sources.
    * **`RCO`** — R&D Collection Owner — is the same accountability where the
      R&D team collects for itself and no external processor is involved. The
      role is separate rather than reusing DCO because the two answer to
      different people, and a permission table that cannot tell them apart
      cannot express that.
    """

    DPO = "dpo"
    DCO = "dco"
    DCO_ADMIN = "dco_admin"
    RCO = "rco"
    RND_USER = "rnd_user"
    ADMIN = "admin"
    DATA_SUBJECT = "data_subject"


class Scope(StrEnum):
    """How far a role can see within a resource it is permitted to call.

    A scope is only ever realised as a WHERE predicate. Applying it to rows that
    have already been fetched is not access control - the rows are already in
    the response, they were already counted, they already moved a cursor.
    """

    ALL = "all"  # every row
    SCOPED = "scoped"  # rows assigned to them (a DCO: projects they are DCO of)
    OWN = "own"  # rows they created, or that are about them
    NONE = "none"  # no rows


@dataclass(frozen=True, slots=True)
class Grant:
    """What one role holds on one resource.

    Frozen: a grant read out of the matrix must not be editable by the code that
    read it. A mutable grant is one careless line away from a request widening
    its own permissions for the rest of the process.
    """

    scope: Scope
    write: bool = False

    @property
    def readable(self) -> bool:
        return self.scope is not Scope.NONE


_DENY = Grant(Scope.NONE)


# Resource -> role -> grant. Derived directly from the API reference permission
# tables. A resource absent from this map is denied to everyone.
MATRIX: dict[str, dict[Role, Grant]] = {
    "user": {
        Role.ADMIN: Grant(Scope.ALL, write=True),
        Role.DPO: Grant(Scope.ALL),  # read-only: DPO sees the register, admin provisions
    },
    "purpose": {
        Role.DPO: Grant(Scope.ALL, write=True),
        Role.ADMIN: Grant(Scope.ALL),
        Role.DCO: Grant(Scope.ALL),
        # Same powers as a DCO. The DCO Admin's reach is wider and the
        # RCO's is in-house; the *kind* of authority is identical, so a
        # row that differed here would be a rule nobody could explain.
        Role.DCO_ADMIN: Grant(Scope.ALL),
        Role.RCO: Grant(Scope.ALL),
        Role.RND_USER: Grant(Scope.ALL),
    },
    "processor": {
        Role.DPO: Grant(Scope.ALL, write=True),
        Role.ADMIN: Grant(Scope.ALL, write=True),
        # Who collects is the R&D User's first decision, taken at creation
        # before any site exists. Read-only would mean filing a ticket to name
        # a partner they have already contracted with.
        Role.RND_USER: Grant(Scope.ALL, write=True),
        Role.DCO: Grant(Scope.ALL),
        # Same powers as a DCO. The DCO Admin's reach is wider and the
        # RCO's is in-house; the *kind* of authority is identical, so a
        # row that differed here would be a rule nobody could explain.
        Role.DCO_ADMIN: Grant(Scope.ALL),
        Role.RCO: Grant(Scope.ALL),
    },
    "data_source": {
        Role.DPO: Grant(Scope.ALL, write=True),
        Role.ADMIN: Grant(Scope.ALL, write=True),
        # A DCO Admin registers the sources under the processors they route
        # for. An R&D User does the same for projects their own team collects.
        Role.DCO_ADMIN: Grant(Scope.ALL, write=True),
        Role.RND_USER: Grant(Scope.ALL, write=True),
        # A DCO and an RCO register the sources they will run: a campus lead
        # who needs a second rig should not have to ask somebody else to type it
        # in. Which *processor* they may register it under is the constraint,
        # not whether they may - a DCO's is a third party's, an RCO's is
        # in-house - and that is enforced in the service, where the processor
        # being written is in hand.
        Role.DCO: Grant(Scope.ALL, write=True),
        Role.RCO: Grant(Scope.ALL, write=True),
    },
    "project": {
        Role.DPO: Grant(Scope.ALL, write=True),
        Role.DCO: Grant(Scope.SCOPED, write=True),
        # Same powers as a DCO. The DCO Admin's reach is wider and the
        # RCO's is in-house; the *kind* of authority is identical, so a
        # row that differed here would be a rule nobody could explain.
        Role.DCO_ADMIN: Grant(Scope.SCOPED, write=True),
        Role.RCO: Grant(Scope.SCOPED, write=True),
        Role.RND_USER: Grant(Scope.OWN, write=True),
    },
    "approval": {
        Role.DPO: Grant(Scope.ALL),
        Role.DCO: Grant(Scope.SCOPED),
        # Same powers as a DCO. The DCO Admin's reach is wider and the
        # RCO's is in-house; the *kind* of authority is identical, so a
        # row that differed here would be a rule nobody could explain.
        Role.DCO_ADMIN: Grant(Scope.SCOPED),
        Role.RCO: Grant(Scope.SCOPED),
        Role.RND_USER: Grant(Scope.OWN, write=True),  # upload proof
    },
    "site": {
        Role.DPO: Grant(Scope.ALL, write=True),
        Role.DCO: Grant(Scope.SCOPED, write=True),
        # Same powers as a DCO. The DCO Admin's reach is wider and the
        # RCO's is in-house; the *kind* of authority is identical, so a
        # row that differed here would be a rule nobody could explain.
        Role.DCO_ADMIN: Grant(Scope.SCOPED, write=True),
        Role.RCO: Grant(Scope.SCOPED, write=True),
        Role.RND_USER: Grant(Scope.OWN),
    },
    "notice": {
        Role.DPO: Grant(Scope.ALL, write=True),
        Role.DCO: Grant(Scope.SCOPED),
        # Same powers as a DCO. The DCO Admin's reach is wider and the
        # RCO's is in-house; the *kind* of authority is identical, so a
        # row that differed here would be a rule nobody could explain.
        Role.DCO_ADMIN: Grant(Scope.SCOPED),
        Role.RCO: Grant(Scope.SCOPED),
        # Write, on their own projects. The R&D User writes the notice now: they
        # are the one who knows what the study collects and why, and the DPO's
        # job is to review that rather than to transcribe it. The DPO keeps
        # Scope.ALL and can still correct any of it.
        Role.RND_USER: Grant(Scope.OWN, write=True),
    },
    "link": {
        Role.DPO: Grant(Scope.ALL, write=True),
        Role.DCO: Grant(Scope.SCOPED, write=True),
        # Same powers as a DCO. The DCO Admin's reach is wider and the
        # RCO's is in-house; the *kind* of authority is identical, so a
        # row that differed here would be a rule nobody could explain.
        Role.DCO_ADMIN: Grant(Scope.SCOPED, write=True),
        Role.RCO: Grant(Scope.SCOPED, write=True),
    },
    "consent": {
        Role.DPO: Grant(Scope.ALL),
        Role.DCO: Grant(Scope.SCOPED),
        # Same powers as a DCO. The DCO Admin's reach is wider and the
        # RCO's is in-house; the *kind* of authority is identical, so a
        # row that differed here would be a rule nobody could explain.
        Role.DCO_ADMIN: Grant(Scope.SCOPED),
        Role.RCO: Grant(Scope.SCOPED),
        Role.RND_USER: Grant(Scope.OWN),  # summary counts only, enforced per-route
    },
    "export": {
        Role.DPO: Grant(Scope.ALL, write=True),
        Role.DCO: Grant(Scope.SCOPED, write=True),
        # Same powers as a DCO. The DCO Admin's reach is wider and the
        # RCO's is in-house; the *kind* of authority is identical, so a
        # row that differed here would be a rule nobody could explain.
        Role.DCO_ADMIN: Grant(Scope.SCOPED, write=True),
        Role.RCO: Grant(Scope.SCOPED, write=True),
    },
    "import": {
        Role.DPO: Grant(Scope.ALL, write=True),
        Role.DCO: Grant(Scope.SCOPED, write=True),
        # Same powers as a DCO. The DCO Admin's reach is wider and the
        # RCO's is in-house; the *kind* of authority is identical, so a
        # row that differed here would be a rule nobody could explain.
        Role.DCO_ADMIN: Grant(Scope.SCOPED, write=True),
        Role.RCO: Grant(Scope.SCOPED, write=True),
        Role.RND_USER: Grant(Scope.OWN, write=True),
    },
    "collection": {
        Role.DPO: Grant(Scope.ALL),
        Role.DCO: Grant(Scope.SCOPED),
        # Same powers as a DCO. The DCO Admin's reach is wider and the
        # RCO's is in-house; the *kind* of authority is identical, so a
        # row that differed here would be a rule nobody could explain.
        Role.DCO_ADMIN: Grant(Scope.SCOPED),
        Role.RCO: Grant(Scope.SCOPED),
        Role.RND_USER: Grant(Scope.OWN),
    },
    "asset": {
        Role.DPO: Grant(Scope.ALL),
        Role.DCO: Grant(Scope.SCOPED),
        # Same powers as a DCO. The DCO Admin's reach is wider and the
        # RCO's is in-house; the *kind* of authority is identical, so a
        # row that differed here would be a rule nobody could explain.
        Role.DCO_ADMIN: Grant(Scope.SCOPED),
        Role.RCO: Grant(Scope.SCOPED),
        Role.RND_USER: Grant(Scope.OWN),
    },
    # Read-only for the two roles that supervise the platform. No role has write:
    # the route is not registered, the grant is revoked, and a trigger refuses it.
    "audit": {
        Role.DPO: Grant(Scope.ALL),
        Role.ADMIN: Grant(Scope.ALL),
    },
    "me": {
        Role.DATA_SUBJECT: Grant(Scope.OWN, write=True),
    },
}


def grant_for(resource: str, role: Role | str) -> Grant:
    try:
        r = Role(role)
    except ValueError:
        return _DENY
    return MATRIX.get(resource, {}).get(r, _DENY)


def can_read(resource: str, role: Role | str) -> bool:
    return grant_for(resource, role).readable


def can_write(resource: str, role: Role | str) -> bool:
    return grant_for(resource, role).write


def scope_of(resource: str, role: Role | str) -> Scope:
    return grant_for(resource, role).scope


# Navigation the SPA renders on first paint — returned by GET /auth/me so the
# frontend never has to guess, and never has to hold a second copy of the matrix.
NAV_BY_ROLE: dict[Role, tuple[str, ...]] = {
    Role.DPO: (
        "dashboard",
        "projects",
        "notices",
        "purposes",
        "processors",
        "sources",
        "consents",
        "links",
        "exports",
        "imports",
        "audit",
        "users",
        # Cover is for the roles whose access is defined by assignment. An R&D
        # User's rows are the ones they created, and authorship is not something
        # somebody else can stand in for - so it is absent there, deliberately,
        # rather than forgotten.
        "cover",
    ),
    Role.DCO: (
        "dashboard",
        "projects",
        "sites",
        # They register the rigs they will run, so they need the registry. What
        # constrains them is which processor they may register under, not
        # whether they may.
        "sources",
        "links",
        "consents",
        "exports",
        "imports",
        "collections",
        "cover",
    ),
    # A DCO Admin does a DCO's job across every third-party project, and one
    # thing besides: routing. `sources` is what makes that possible - the queue
    # is sites with no source attached, and attaching one is the whole action.
    Role.DCO_ADMIN: (
        "dashboard",
        "projects",
        "sites",
        "sources",
        "links",
        "consents",
        "exports",
        "imports",
        "collections",
        "cover",
    ),
    # An RCO is a DCO for collection the R&D team does itself - same nav, and
    # the same registry, restricted to in-house processors rather than a third
    # party's.
    Role.RCO: (
        "dashboard",
        "projects",
        "sites",
        "sources",
        "links",
        "consents",
        "exports",
        "imports",
        "collections",
        "cover",
    ),
    # `notices` and `processors` because the R&D User now writes the notice and
    # names who will collect. Both were the DPO's, and both were things the DPO
    # had to be told before they could enter them.
    Role.RND_USER: (
        "dashboard",
        "projects",
        "notices",
        "processors",
        "approvals",
        "imports",
        "collections",
    ),
    # An administrator does not arrange their own cover - they have no assigned
    # rows - but they can see and arrange it for anybody who is unreachable.
    Role.ADMIN: ("dashboard", "users", "processors", "sources", "audit", "cover"),
    Role.DATA_SUBJECT: ("consents", "notifications", "profile"),
}


def nav_for(role: Role | str) -> list[str]:
    try:
        return list(NAV_BY_ROLE.get(Role(role), ()))
    except ValueError:
        return []
