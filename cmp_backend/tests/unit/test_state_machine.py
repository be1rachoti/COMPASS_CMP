"""The transition table is a specification, so it gets tested as one.

The interesting assertions are the negative ones. Any state machine test can show
that the happy path works; what protects the project is proving that the 19
transitions which must *not* exist do not exist, and that no role can reach
`approved` without passing through the two gates in front of it.
"""

from __future__ import annotations

import itertools

import pytest

from cmp.core.errors import TransitionNotPermitted
from cmp.core.permissions import Role
from cmp.domain.state_machine import (
    ProjectFacts,
    ProjectStatus,
    available,
    creation_requirements,
    validate,
)

S = ProjectStatus

# Exactly the table in DATA-MODEL.md.
LEGAL: set[tuple[S, S, Role]] = {
    (S.IN_DRAFT, S.UNDER_PROCESS, Role.DPO),
    (S.UNDER_PROCESS, S.PENDING_APPROVAL, Role.RND_USER),
    (S.UNDER_PROCESS, S.IN_DRAFT, Role.DPO),
    (S.PENDING_APPROVAL, S.APPROVED, Role.DPO),
    (S.PENDING_APPROVAL, S.IN_DRAFT, Role.DPO),
    (S.APPROVED, S.CLOSED, Role.DPO),
    (S.APPROVED, S.CLOSED, Role.DCO),
}

SATISFIED = ProjectFacts(
    has_notice=True,
    notice_purpose_count=2,
    notice_rule3_complete=True,
    approval_with_proof_count=1,
    has_dco=True,
    has_description=True,
    review_recorded=True,
)


@pytest.mark.parametrize(("frm", "to", "role"), sorted(LEGAL, key=str))
def test_every_legal_transition_is_permitted(frm: S, to: S, role: Role) -> None:
    t = validate(current=frm, target=to, role=role, facts=SATISFIED, reason="because")
    assert t.to is to


def test_no_transition_outside_the_table_exists() -> None:
    """Every (from, to, role) triple not in the table must raise.

    5 states x 5 states x 5 roles = 125 combinations; 7 are legal. This is the
    assertion that catches a future edit which adds a shortcut.
    """
    for frm, to, role in itertools.product(S, S, Role):
        if (frm, to, role) in LEGAL:
            continue
        with pytest.raises(TransitionNotPermitted):
            validate(current=frm, target=to, role=role, facts=SATISFIED, reason="r")


def test_there_is_no_path_from_draft_to_approved() -> None:
    for role in Role:
        with pytest.raises(TransitionNotPermitted):
            validate(current=S.IN_DRAFT, target=S.APPROVED, role=role, facts=SATISFIED)


def test_approved_cannot_go_backwards() -> None:
    for target in (S.IN_DRAFT, S.UNDER_PROCESS, S.PENDING_APPROVAL):
        for role in Role:
            with pytest.raises(TransitionNotPermitted):
                validate(current=S.APPROVED, target=target, role=role,
                         facts=SATISFIED, reason="r")


def test_closed_is_terminal() -> None:
    for target, role in itertools.product(S, Role):
        with pytest.raises(TransitionNotPermitted):
            validate(current=S.CLOSED, target=target, role=role,
                     facts=SATISFIED, reason="r")


# ------------------------------------------------------------- preconditions
def test_publication_requires_a_notice_with_purposes() -> None:
    with pytest.raises(TransitionNotPermitted, match="no notice"):
        validate(current=S.IN_DRAFT, target=S.UNDER_PROCESS, role=Role.DPO,
                 facts=ProjectFacts())

    with pytest.raises(TransitionNotPermitted, match="no purposes"):
        validate(current=S.IN_DRAFT, target=S.UNDER_PROCESS, role=Role.DPO,
                 facts=ProjectFacts(has_notice=True))

    with pytest.raises(TransitionNotPermitted, match="Rule 3"):
        validate(current=S.IN_DRAFT, target=S.UNDER_PROCESS, role=Role.DPO,
                 facts=ProjectFacts(has_notice=True, notice_purpose_count=1))


def test_pending_approval_requires_proof_not_merely_an_approval() -> None:
    """INV-8: an approval row without a proof file does not unlock the transition."""
    with pytest.raises(TransitionNotPermitted, match="proof file"):
        validate(current=S.UNDER_PROCESS, target=S.PENDING_APPROVAL, role=Role.RND_USER,
                 facts=ProjectFacts(approval_with_proof_count=0))


def test_return_to_draft_requires_a_reason() -> None:
    for frm in (S.UNDER_PROCESS, S.PENDING_APPROVAL):
        with pytest.raises(TransitionNotPermitted, match="reason"):
            validate(current=frm, target=S.IN_DRAFT, role=Role.DPO,
                     facts=SATISFIED, reason="   ")
        assert validate(current=frm, target=S.IN_DRAFT, role=Role.DPO,
                        facts=SATISFIED, reason="Missing site list").to is S.IN_DRAFT


def test_role_error_precedes_precondition_error() -> None:
    """An unauthorised caller must not learn whether the project is ready.

    A DCO asking to approve gets "you may not", never "the review is not
    recorded" - the second sentence is intelligence about a project they cannot
    act on.
    """
    with pytest.raises(TransitionNotPermitted) as exc:
        validate(current=S.PENDING_APPROVAL, target=S.APPROVED, role=Role.DCO,
                 facts=ProjectFacts(review_recorded=False))
    assert exc.value.code == "transition_role_not_permitted"
    assert "review" not in exc.value.message.lower()


# ------------------------------------------------------- the transitions view
def test_available_reports_blockers_without_hiding_the_transition() -> None:
    """The UI shows a disabled button with a reason, not a missing button."""
    view = available(S.UNDER_PROCESS, Role.RND_USER, ProjectFacts())
    assert view == [{"to": "pending_approval", "allowed": False,
                     "blocked_by": "No approval with a proof file"}]


def test_available_hides_transitions_this_role_may_never_perform() -> None:
    assert available(S.PENDING_APPROVAL, Role.RND_USER, SATISFIED) == []
    assert available(S.IN_DRAFT, Role.DCO, SATISFIED) == []


def test_available_flags_reason_and_publication_side_effect() -> None:
    view = {e["to"]: e for e in available(S.UNDER_PROCESS, Role.DPO, SATISFIED)}
    assert view["in_draft"]["reason_required"] is True

    draft_view = available(S.IN_DRAFT, Role.DPO, SATISFIED)
    assert draft_view[0]["publishes_notice"] is True


def test_closed_offers_nothing_to_anyone() -> None:
    for role in Role:
        assert available(S.CLOSED, role, SATISFIED) == []


# ------------------------------------------------------------------ creation
def test_creation_requires_name_description_and_a_nominated_dco() -> None:
    assert creation_requirements(name=None, description=None, dco_user_uuid=None) == [
        "project_name is required",
        "description is required",
        "a nominated DCO is required",
    ]
    assert creation_requirements(name="P", description="d", dco_user_uuid="u") == []
    assert creation_requirements(name="  ", description="d", dco_user_uuid="u") == [
        "project_name is required"
    ]
