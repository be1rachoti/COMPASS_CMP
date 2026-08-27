"""The permission matrix says what it looks like it says.

A dict literal with the same key twice is legal Python. The later entry wins and
nothing warns, so a resource row can carry two grants for one role and the
weaker one silently decides. That is not a hypothetical: mirroring the DCO's
grants onto two new roles added a second `data_source` entry for `dco_admin`
underneath an existing write grant, and the effect was a role that could not
register the sources its whole job consists of registering. Nothing failed - the
matrix simply meant something other than what it read as.

The interpreter cannot catch it, because by the time the module is imported the
duplicate is already gone. So this reads the source instead.
"""

from __future__ import annotations

import ast
import pathlib

import pytest

from cmp.core.permissions import MATRIX, Role


def _matrix_literal() -> ast.Dict:
    """The MATRIX assignment as written, before Python collapses it."""
    import cmp.core.permissions as module

    source = pathlib.Path(module.__file__).read_text(encoding="utf-8")
    for node in ast.walk(ast.parse(source)):
        is_matrix = (
            isinstance(node, ast.AnnAssign) and getattr(node.target, "id", "") == "MATRIX"
        ) or (
            isinstance(node, ast.Assign)
            and any(isinstance(t, ast.Name) and t.id == "MATRIX" for t in node.targets)
        )
        if is_matrix and isinstance(node.value, ast.Dict):
            return node.value
    raise AssertionError("MATRIX is no longer a dict literal in cmp.core.permissions")


def test_no_resource_declares_a_role_twice() -> None:
    literal = _matrix_literal()
    offenders: list[str] = []

    for resource_key, grants in zip(literal.keys, literal.values, strict=True):
        assert isinstance(grants, ast.Dict), "every MATRIX entry is a dict of role -> Grant"
        seen: set[str] = set()
        for role_key in grants.keys:
            name = ast.unparse(role_key)
            if name in seen:
                offenders.append(f"{ast.literal_eval(resource_key)}: {name}")
            seen.add(name)

    assert not offenders, (
        "a role appears twice in one resource row; the later Grant silently wins: "
        + ", ".join(offenders)
    )


def test_every_resource_row_is_keyed_by_a_real_role() -> None:
    """A typo'd role name is a grant nobody holds and nothing reports.

    `Role.DCO_ADMN` would be an AttributeError, so this is really about the
    reverse: a key that parses but is not a `Role` member at all.
    """
    for resource, grants in MATRIX.items():
        for role in grants:
            assert isinstance(role, Role), f"{resource} is keyed by {role!r}, which is not a Role"


@pytest.mark.parametrize("role", [Role.DCO_ADMIN, Role.RCO])
def test_the_new_roles_reach_everything_a_dco_does(role: Role) -> None:
    """Both were introduced as a DCO's authority, differently scoped.

    A resource a DCO can read and they cannot is a hole somebody will find as a
    404 on a page their nav offers them - which is exactly how the duplicate key
    above would have surfaced, eventually, to a user rather than to a test.
    """
    missing = [
        resource
        for resource, grants in MATRIX.items()
        if Role.DCO in grants and grants[Role.DCO].readable and not grants.get(role, None)
    ]
    assert not missing, f"{role.value} cannot read what a DCO can: {missing}"


def test_every_collection_role_can_register_a_data_source() -> None:
    """The grant a duplicate key once silently removed from the DCO Admin.

    A DCO and an RCO hold it too: a campus lead who needs a second rig should
    not have to ask somebody else to type it in. What constrains them is *which
    processor* they may register under - a DCO's is a third party's, an RCO's is
    in-house - and that lives in `registry._refuse_foreign_processor`, because
    the matrix answers "may this role write here at all" and the answer is yes.
    """
    for role in (Role.DCO_ADMIN, Role.DCO, Role.RCO, Role.RND_USER):
        assert MATRIX["data_source"][role].write, f"{role.value} cannot register a source"


def test_a_data_principal_cannot_touch_the_registry() -> None:
    """The boundary the row above widened up to, and not past."""
    assert not MATRIX["data_source"].get(Role.DATA_SUBJECT)


class TestRoleListsAreDerivedRatherThanTyped:
    """A role added later must not be silently left out of a list of roles.

    Both failures this guards against had the same shape and neither raised
    anything: a hardcoded staff list left the DCO Admin unable to read the
    ownership lookup its own routing screen is built on, and a hardcoded nav
    list dropped a section the server said the role had. In each case the code
    was correct for the roles it named and wrong about the one it did not.
    """

    def test_staff_is_everyone_who_is_not_a_data_principal(self) -> None:
        from cmp.api.dependencies.common import STAFF_ROLES

        assert set(STAFF_ROLES) == set(Role) - {Role.DATA_SUBJECT}

    def test_every_staff_role_has_navigation(self) -> None:
        """A role with an empty sidebar can sign in and reach nothing.

        Worse than an error, because the page loads: they are left looking at a
        console that appears to be working and simply has nothing on it.
        """
        from cmp.core.permissions import nav_for

        missing = [r.value for r in Role if r is not Role.DATA_SUBJECT and not nav_for(r)]
        assert not missing, f"roles with no navigation at all: {missing}"

    def test_every_navigable_section_is_one_the_role_can_actually_read(self) -> None:
        """The sidebar is a promise. A link to a 403 is a broken one.

        Only the sections that map onto a matrix resource are checked - some are
        pages rather than resources ("profile", "cover", "notifications"), and
        those have their own guards.
        """
        from cmp.core.permissions import can_read, nav_for

        section_resource = {
            "projects": "project",
            "notices": "notice",
            "purposes": "purpose",
            "processors": "processor",
            "sources": "data_source",
            "consents": "consent",
            "links": "link",
            "exports": "export",
            "collections": "collection",
            "audit": "audit",
            "users": "user",
        }

        # One key means two things. A data subject's "consents" is her own
        # record, served by the data-subject routes and guarded by
        # `RequireDataSubject`, not the staff register the matrix is about. The
        # sidebar resolves the same key to `/my-consents` for her.
        aliased = {(Role.DATA_SUBJECT, "consents")}

        broken: list[str] = []
        for role in Role:
            for section in nav_for(role):
                if (role, section) in aliased:
                    continue
                resource = section_resource.get(section)
                if resource and not can_read(resource, role):
                    broken.append(f"{role.value} -> /{section}")

        assert not broken, f"navigation offers what the matrix denies: {broken}"
