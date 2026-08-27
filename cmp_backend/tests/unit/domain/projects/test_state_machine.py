"""The transition table is a specification, so it gets tested as one.

The interesting assertions are the negative ones. Any state machine test can show
that the happy path works; what protects the project is proving that the
transitions which must *not* exist do not exist, and that no role can reach
`approved` without passing through the gate in front of it.
"""

from __future__ import annotations

import itertools

import pytest

from cmp.core.errors import TransitionNotPermitted
from cmp.core.permissions import Role
from cmp.domain.projects.state_machine import (
    ProjectFacts,
    ProjectStatus,
    available,
    creation_requirements,
    validate,
)

S = ProjectStatus

# Exactly the table in DATA-MODEL.md.
#
# `under_process` is unreachable and keeps `in_draft`'s way out, so its row here
# mirrors the draft row rather than being absent. A history row naming it must
# not become a project nobody can move.
LEGAL: set[tuple[S, S, Role]] = {
    (S.IN_DRAFT, S.PENDING_APPROVAL, Role.RND_USER),
    (S.UNDER_PROCESS, S.PENDING_APPROVAL, Role.RND_USER),
    (S.PENDING_APPROVAL, S.APPROVED, Role.DPO),
    (S.PENDING_APPROVAL, S.IN_DRAFT, Role.DPO),
    (S.APPROVED, S.CLOSED, Role.DPO),
    (S.APPROVED, S.CLOSED, Role.DCO),
    (S.APPROVED, S.CLOSED, Role.DCO_ADMIN),
    (S.APPROVED, S.CLOSED, Role.RCO),
}

SATISFIED = ProjectFacts(
    has_notice=True,
    notice_purpose_count=2,
    notice_rule3_complete=True,
    notice_audience_set=True,
    notice_language_count=1,
    notice_language_approved=True,
    approval_with_proof_count=1,
    has_processor=True,
    has_description=True,
    review_recorded=True,
)

#: Everything the author can do, and nothing that needs the reviewer.
#:
#: The state this exists to describe is the one that used to deadlock: the notice
#: is written and complete, the approval is uploaded, and the only outstanding
#: thing is somebody else's signature.
AUTHOR_DONE = ProjectFacts(
    has_notice=True,
    notice_purpose_count=2,
    notice_rule3_complete=True,
    notice_audience_set=True,
    notice_language_count=1,
    notice_language_approved=False,
    approval_with_proof_count=1,
    has_processor=True,
    has_description=True,
    review_recorded=True,
)


@pytest.mark.parametrize(("frm", "to", "role"), sorted(LEGAL, key=str))
def test_every_legal_transition_is_permitted(frm: S, to: S, role: Role) -> None:
    t = validate(current=frm, target=to, role=role, facts=SATISFIED, reason="because")
    assert t.to is to


def test_no_transition_outside_the_table_exists() -> None:
    """Every (from, to, role) triple not in the table must raise.

    5 states x 5 states x 7 roles = 175 combinations; 8 are legal. This is the
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


def test_nothing_transitions_into_under_process() -> None:
    """It is retained for history rows and is not a state anything can enter.

    Kept as its own test rather than left to the exhaustive sweep above, because
    this is the property that would be quietly lost by re-adding a row to LEGAL.
    """
    for frm, role in itertools.product(S, Role):
        with pytest.raises(TransitionNotPermitted):
            validate(current=frm, target=S.UNDER_PROCESS, role=role, facts=SATISFIED, reason="r")


def test_approved_cannot_go_backwards() -> None:
    for target in (S.IN_DRAFT, S.UNDER_PROCESS, S.PENDING_APPROVAL):
        for role in Role:
            with pytest.raises(TransitionNotPermitted):
                validate(current=S.APPROVED, target=target, role=role, facts=SATISFIED, reason="r")


def test_closed_is_terminal() -> None:
    for target, role in itertools.product(S, Role):
        with pytest.raises(TransitionNotPermitted):
            validate(current=S.CLOSED, target=target, role=role, facts=SATISFIED, reason="r")


# ------------------------------------------------------------- preconditions
def test_submitting_requires_a_complete_notice() -> None:
    """The requirements are checked in the order somebody assembles them."""
    for facts, expected in [
        (ProjectFacts(), "no notice"),
        (ProjectFacts(has_notice=True), "no purposes"),
        (ProjectFacts(has_notice=True, notice_purpose_count=1), "Rule 3"),
        (
            ProjectFacts(has_notice=True, notice_purpose_count=1, notice_rule3_complete=True),
            "who it applies to",
        ),
        (
            ProjectFacts(
                has_notice=True,
                notice_purpose_count=1,
                notice_rule3_complete=True,
                notice_audience_set=True,
            ),
            "no text yet",
        ),
    ]:
        with pytest.raises(TransitionNotPermitted, match=expected):
            validate(current=S.IN_DRAFT, target=S.PENDING_APPROVAL, role=Role.RND_USER, facts=facts)


def test_submitting_requires_proof_not_merely_an_approval() -> None:
    """INV-8: an approval row without a proof file does not unlock the transition."""
    ready_but_unapproved = ProjectFacts(
        has_notice=True,
        notice_purpose_count=1,
        notice_rule3_complete=True,
        notice_audience_set=True,
        notice_language_count=1,
        approval_with_proof_count=0,
    )
    with pytest.raises(TransitionNotPermitted, match="proof file"):
        validate(
            current=S.IN_DRAFT,
            target=S.PENDING_APPROVAL,
            role=Role.RND_USER,
            facts=ready_but_unapproved,
        )


def test_return_to_draft_requires_a_reason() -> None:
    with pytest.raises(TransitionNotPermitted, match="reason"):
        validate(
            current=S.PENDING_APPROVAL,
            target=S.IN_DRAFT,
            role=Role.DPO,
            facts=SATISFIED,
            reason="   ",
        )
    assert (
        validate(
            current=S.PENDING_APPROVAL,
            target=S.IN_DRAFT,
            role=Role.DPO,
            facts=SATISFIED,
            reason="Missing site list",
        ).to
        is S.IN_DRAFT
    )


def test_role_error_precedes_precondition_error() -> None:
    """An unauthorised caller must not learn whether the project is ready.

    A DCO asking to approve gets "you may not", never "the review is not
    recorded" - the second sentence is intelligence about a project they cannot
    act on.
    """
    with pytest.raises(TransitionNotPermitted) as exc:
        validate(
            current=S.PENDING_APPROVAL,
            target=S.APPROVED,
            role=Role.DCO,
            facts=ProjectFacts(review_recorded=False),
        )
    assert exc.value.code == "transition_role_not_permitted"
    assert "review" not in exc.value.message.lower()


# ------------------------------------------------------- the transitions view
def test_available_reports_blockers_without_hiding_the_transition() -> None:
    """The UI shows a disabled button with a reason, not a missing button."""
    view = available(S.IN_DRAFT, Role.RND_USER, ProjectFacts())
    assert view == [
        {"to": "pending_approval", "allowed": False, "blocked_by": "The project has no notice"}
    ]


def test_available_hides_transitions_this_role_may_never_perform() -> None:
    assert available(S.PENDING_APPROVAL, Role.RND_USER, SATISFIED) == []
    assert available(S.IN_DRAFT, Role.DCO, SATISFIED) == []
    # The DPO does not submit on the author's behalf. Assembly is the R&D User's,
    # and a DPO who could submit could also submit something they then review.
    assert available(S.IN_DRAFT, Role.DPO, SATISFIED) == []


def test_publication_happens_at_approval_not_before() -> None:
    """The notice goes live when the decision behind it is taken, and not sooner.

    A notice published while the project was still being assembled was a promise
    made on behalf of an approval nobody had given.
    """
    approving = {e["to"]: e for e in available(S.PENDING_APPROVAL, Role.DPO, SATISFIED)}
    assert approving["approved"]["publishes_notice"] is True
    assert approving["in_draft"]["reason_required"] is True
    assert "publishes_notice" not in approving["in_draft"]

    submitting = available(S.IN_DRAFT, Role.RND_USER, SATISFIED)
    assert "publishes_notice" not in submitting[0]


def test_closed_offers_nothing_to_anyone() -> None:
    for role in Role:
        assert available(S.CLOSED, role, SATISFIED) == []


# ------------------------------------------------------------------ creation
def test_creation_requires_name_description_and_a_processor() -> None:
    assert creation_requirements(name=None, description=None, processor_count=0) == [
        "project_name is required",
        "description is required",
        "at least one processor is required",
    ]
    assert creation_requirements(name="P", description="d", processor_count=1) == []
    assert creation_requirements(name="  ", description="d", processor_count=2) == [
        "project_name is required"
    ]


def test_creation_no_longer_asks_for_a_dco() -> None:
    """Which person is accountable follows from the sources, which do not exist yet.

    Pinned as its own test because re-adding the field would be an easy way to
    make an old form pass again, and it would put the answer back before the
    question is answerable.
    """
    with pytest.raises(TypeError):
        creation_requirements(  # type: ignore[call-arg]
            name="P", description="d", dco_user_uuid="u"
        )


# ------------------------------------------------- who has to do what, and when
class TestLegalApprovalGatesTheReviewerNotTheAuthor:
    """Reported: "RnD attached the notice, it is still not with the DPO and hence
    can't have legally approved state."

    The submission gate required an approved language. Approving a language is
    the DPO's act. The DPO does not see a project until it is submitted. So the
    author was blocked on somebody who was blocked on the author, and neither
    screen said so - the button was simply disabled forever.

    The check did not go away. It moved to the gate in front of the person who
    can satisfy it.
    """

    def test_the_author_can_submit_without_the_text_being_approved(self) -> None:
        moved = validate(
            current=S.IN_DRAFT,
            target=S.PENDING_APPROVAL,
            role=Role.RND_USER,
            facts=AUTHOR_DONE,
        )
        assert moved.to is S.PENDING_APPROVAL

    def test_the_dpo_cannot_approve_the_project_until_the_text_is(self) -> None:
        with pytest.raises(TransitionNotPermitted, match="not legally approved") as exc:
            validate(
                current=S.PENDING_APPROVAL,
                target=S.APPROVED,
                role=Role.DPO,
                facts=AUTHOR_DONE,
            )
        assert exc.value.code == "transition_blocked"

    def test_the_dpo_is_told_what_to_do_rather_than_that_something_is_wrong(self) -> None:
        """The blocker is the DPO's own next action, so it names it.

        "The notice is not legally approved" describes a state. This has to say
        which control to reach for, because the person reading it is one click
        away from being able to fix it.
        """
        view = {e["to"]: e for e in available(S.PENDING_APPROVAL, Role.DPO, AUTHOR_DONE)}
        assert view["approved"]["allowed"] is False
        assert "approve every language" in view["approved"]["blocked_by"]

    def test_sending_it_back_to_draft_is_still_open(self) -> None:
        """The DPO is not cornered by the blocked approval.

        A reviewer who can neither approve nor return a project has one way out:
        approving something they should not. The other transition stays
        available and carries no precondition beyond a reason.
        """
        view = {e["to"]: e for e in available(S.PENDING_APPROVAL, Role.DPO, AUTHOR_DONE)}
        assert view["in_draft"]["allowed"] is True

    def test_writing_the_text_is_still_the_authors_job(self) -> None:
        """Only the *approval* moved. A notice with no rendition cannot be
        submitted, because the DPO would be asked to review nothing."""
        no_text = ProjectFacts(
            has_notice=True,
            notice_purpose_count=1,
            notice_rule3_complete=True,
            notice_audience_set=True,
            notice_language_count=0,
            approval_with_proof_count=1,
        )
        with pytest.raises(TransitionNotPermitted, match="no text yet"):
            validate(
                current=S.IN_DRAFT,
                target=S.PENDING_APPROVAL,
                role=Role.RND_USER,
                facts=no_text,
            )
