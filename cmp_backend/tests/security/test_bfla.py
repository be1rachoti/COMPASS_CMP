"""Broken Function Level Authorisation — OWASP API5.

BOLA asks "may this caller have *that row*". This asks the prior question: "may
this caller call this *function* at all". The failure is a role reaching an
endpoint that was never meant for it — an R&D User provisioning accounts, a DCO
publishing a notice, anyone writing to the audit trail.

The matrix is the single definition, so these tests are written against the
matrix rather than against a list of routes. That matters: a test enumerating
routes goes stale the moment somebody adds one, and a stale authorisation test
is worse than none because it reads as coverage.

Every assertion here is a **negative** one. Proving the DPO can publish a notice
is a functional test; proving nobody else can is the security test.
"""

from __future__ import annotations

import pytest

from cmp.auth.authorization import resources
from cmp.auth.authorization.evaluator import (
    can_read,
    can_write,
    evaluate,
    readable_resources,
    scope_of,
    writable_resources,
)
from cmp.core.permissions import Role, Scope

ALL_ROLES = tuple(Role)


class TestTheAuditTrailIsWritableByNobody:
    """The single most important negative in the system.

    The Privacy Office is audited by this table. A DPO who can edit her own
    audit trail makes it worthless as evidence — which is why the defence is
    four-deep: no route, no matrix grant, no database privilege, and a trigger.
    This asserts the second of those.
    """

    @pytest.mark.parametrize("role", ALL_ROLES)
    def test_no_role_may_write_audit(self, role: Role) -> None:
        assert not can_write(resources.AUDIT, role), (
            f"{role.value} has a write grant on the audit trail"
        )

    @pytest.mark.parametrize("role", [Role.DCO, Role.RND_USER, Role.DATA_SUBJECT])
    def test_only_the_supervising_roles_may_read_it(self, role: Role) -> None:
        assert not can_read(resources.AUDIT, role)

    def test_the_supervising_roles_can(self) -> None:
        assert can_read(resources.AUDIT, Role.DPO)
        assert can_read(resources.AUDIT, Role.ADMIN)


class TestProvisioningIsAdminOnly:
    """Creating accounts and changing roles is the escalation path.

    The DPO deliberately has read-only access to the register: she supervises
    the platform, and a supervisor who can also grant themselves permissions is
    not a control. Splitting read from write means neither role can quietly widen
    its own access.
    """

    def test_only_admin_may_write_users(self) -> None:
        assert can_write(resources.USER, Role.ADMIN)
        for role in (Role.DPO, Role.DCO, Role.RND_USER, Role.DATA_SUBJECT):
            assert not can_write(resources.USER, role), f"{role.value} may write users"

    def test_the_dpo_reads_but_does_not_write(self) -> None:
        assert can_read(resources.USER, Role.DPO)
        assert not can_write(resources.USER, Role.DPO)

    @pytest.mark.parametrize("role", [Role.DCO, Role.RND_USER, Role.DATA_SUBJECT])
    def test_nobody_else_reads_the_register(self, role: Role) -> None:
        assert not can_read(resources.USER, role)


class TestNoticeAuthorshipIsSeparateFromApproval:
    """Publishing freezes text that consent will be given against.

    The R&D User writes the notice, because they are the one who knows what the
    study collects and why. What they cannot do is publish it: publication is
    the DPO's, and it is enforced at the route rather than in this matrix,
    because the matrix answers "may this role write notices at all" and the
    answer for an author is yes.

    So the property this class protects is narrower than it used to be, and more
    precisely stated: an author's write is confined to their *own* projects, and
    nobody outside those two roles writes a notice at all.
    """

    def test_the_dpo_and_the_author_may_write(self) -> None:
        assert can_write(resources.NOTICE, Role.DPO)
        assert can_write(resources.NOTICE, Role.RND_USER)

    def test_the_author_is_confined_to_their_own_projects(self) -> None:
        """The difference between an author and the DPO, in one assertion.

        Without this, granting the R&D User write access would silently be a
        grant over every notice in the organisation.
        """
        assert scope_of(resources.NOTICE, Role.RND_USER) is Scope.OWN
        assert scope_of(resources.NOTICE, Role.DPO) is Scope.ALL

    @pytest.mark.parametrize(
        "role", [Role.DCO, Role.DCO_ADMIN, Role.RCO, Role.ADMIN, Role.DATA_SUBJECT]
    )
    def test_nobody_else_writes_a_notice(self, role: Role) -> None:
        assert not can_write(resources.NOTICE, role), f"{role.value} may write notices"


class TestTheDataSubjectSurfaceIsExactlyOne:
    """A data subject reaches `/me` and nothing else.

    She is not staff. Every staff resource must be closed to her — and this is
    the test that catches a new resource being added without anyone thinking
    about whether she should see it, because it iterates the roster rather than
    a fixed list.
    """

    def test_she_can_read_only_me(self) -> None:
        assert readable_resources(Role.DATA_SUBJECT) == [resources.ME]

    def test_she_can_write_only_me(self) -> None:
        assert writable_resources(Role.DATA_SUBJECT) == [resources.ME]

    @pytest.mark.parametrize("resource", sorted(resources.ALL - {resources.ME}))
    def test_every_other_resource_is_closed_to_her(self, resource: str) -> None:
        assert not can_read(resource, Role.DATA_SUBJECT), f"a data subject can read {resource}"


class TestStaffCannotReachTheSubjectSurface:
    """The reverse: `/me` is the data subject's own record.

    A DPO reaching `/me` as a staff member would be reading a resource whose
    entire scope model assumes the caller *is* the subject.
    """

    @pytest.mark.parametrize("role", [Role.DPO, Role.DCO, Role.RND_USER, Role.ADMIN])
    def test_staff_have_no_grant_on_me(self, role: Role) -> None:
        assert not can_read(resources.ME, role)


class TestFailClosed:
    """Anything the matrix does not know about is denied."""

    @pytest.mark.parametrize("role", ALL_ROLES)
    def test_an_unknown_resource_is_denied_to_every_role(self, role: Role) -> None:
        assert not can_read("not_a_resource", role)
        assert not can_write("not_a_resource", role)

    @pytest.mark.parametrize("resource", sorted(resources.ALL))
    def test_an_unknown_role_is_denied_every_resource(self, resource: str) -> None:
        assert not can_read(resource, "superuser")
        assert not can_write(resource, "superuser")

    def test_the_denial_carries_a_reason(self) -> None:
        """A denial reaches the audit trail; "denied" alone is unactionable."""
        decision = evaluate(resources.AUDIT, Role.RND_USER)
        assert not decision.allowed
        assert decision.reason

    def test_a_read_only_grant_refuses_a_write_and_says_so(self) -> None:
        decision = evaluate(resources.USER, Role.DPO, write=True)
        assert not decision.allowed
        assert "read-only" in decision.reason


class TestWriteImpliesRead:
    """No grant may be write-without-read.

    Not a rule anyone would break deliberately; it is a typo check. A grant
    written as `Grant(Scope.NONE, write=True)` would pass a write check and fail
    every read, producing an endpoint that accepts changes to rows it claims do
    not exist.
    """

    @pytest.mark.parametrize("resource", sorted(resources.ALL))
    def test_every_writable_grant_is_also_readable(self, resource: str) -> None:
        for role in ALL_ROLES:
            if can_write(resource, role):
                assert can_read(resource, role), (
                    f"{role.value} may write {resource} but not read it"
                )
