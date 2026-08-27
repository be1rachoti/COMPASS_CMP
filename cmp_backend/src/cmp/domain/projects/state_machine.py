# ruff: noqa: E501 - the transition table below is transcribed from DATA-MODEL.md.
# Re-wrapping it to 100 columns would make it unreadable, and an unreadable copy
# of a specification is worse than no copy.
"""The project state machine.

Four reachable states, five transitions, and nothing else. From DATA-MODEL.md:

| From                | To                 | Actor                   | Requires                                                        |
|---------------------|--------------------|-------------------------|-----------------------------------------------------------------|
| -                   | `in_draft`         | RnD User                | name, description, >=1 processor                                |
| `in_draft`          | `pending_approval` | RnD User                | notice with >=1 purpose, all Rule 3 links, an audience, its text written, and >=1 project_approval **with proof file** |
| `pending_approval`  | `approved`         | DPO                     | every language legally approved; publishes the notice           |
| `pending_approval`  | `in_draft`         | DPO                     | a reason                                                        |
| `approved`          | `closed`           | DPO or a collection owner | -                                                             |

There is no path from `in_draft` to `approved`, and none back from `approved`
except to `closed`.

**Why `under_process` is gone.** It used to sit between the two states above, and
belonged to the DPO: the R&D User assembled a project, the DPO published its
notice, and only then could the R&D User attach the approval and submit. That put
a second person's step in the middle of one person's work, so a project waited on
somebody whose actual job - reviewing it - had not started yet. Assembly is now
one state, `in_draft`, and the DPO is asked once, at the end, when there is
something to review.

Publication moved with it. The notice goes live at `approved`, which is also when
it becomes true: a notice published before the project it describes was approved
was a promise made on behalf of a decision nobody had taken.

**Why legal approval of the text is not a submission requirement.** It was, and
it deadlocked: approving a language is the DPO's act, the author could not submit
without it, and the DPO does not see the project until it is submitted. Each side
was waiting for the other and nothing on either screen said so.

So the two halves are separated by who does them. The author writes the notice
and its text; the DPO approves that text and then approves the project. The check
did not go away - it moved to the gate in front of the person who can satisfy it,
where being blocked is actionable rather than circular.

`ProjectStatus.UNDER_PROCESS` survives as a value because
`project_status_history` rows still name it. Nothing transitions *to* it.

This module is pure: it takes a status, a role and a snapshot of facts, and
returns what is permitted. It touches no database and no request. That is what
lets `GET /projects/{uuid}/transitions` and `POST /projects/{uuid}/transition`
share one definition instead of drifting into two - and lets the whole table be
tested without a fixture.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import StrEnum

from cmp.core.errors import TransitionNotPermitted
from cmp.core.permissions import Role


class ProjectStatus(StrEnum):
    IN_DRAFT = "in_draft"
    #: Historical only. See the module docstring - no transition names it.
    UNDER_PROCESS = "under_process"
    PENDING_APPROVAL = "pending_approval"
    APPROVED = "approved"
    CLOSED = "closed"


#: Who may close an approved project: the DPO, or whoever was accountable for
#: collecting under it. A DCO Admin oversees third-party collection and an RCO
#: owns in-house collection, so both hold a DCO's authority over the projects
#: they are answerable for.
COLLECTION_OWNERS = frozenset({Role.DCO, Role.DCO_ADMIN, Role.RCO})


@dataclass(frozen=True, slots=True)
class ProjectFacts:
    """What the domain needs to know to answer "may this move?".

    Assembled by the service from one query. Deliberately a value object: the
    state machine must not be able to reach back into the database and get a
    different answer halfway through a decision.
    """

    has_notice: bool = False
    notice_purpose_count: int = 0
    #: The Rule 3 elements the *author* writes. Deliberately excludes whether
    #: the text has been legally approved - see `notice_language_approved`.
    notice_rule3_complete: bool = False
    notice_audience_set: bool = False
    #: Renditions written. The author's work.
    notice_language_count: int = 0
    #: Every rendition legally approved. The DPO's, and the reason it gates the
    #: DPO's own transition rather than the author's.
    notice_language_approved: bool = False
    notice_published: bool = False
    approval_with_proof_count: int = 0
    has_processor: bool = False
    has_description: bool = False
    review_recorded: bool = False


@dataclass(frozen=True, slots=True)
class Requirement:
    """One precondition, and the sentence the UI shows when it is not met."""

    met: bool
    message: str


@dataclass(frozen=True, slots=True)
class Transition:
    to: ProjectStatus
    actors: frozenset[Role]
    reason_required: bool = False
    # side effect, stated in the table itself rather than buried in a service
    publishes_notice: bool = False
    requirements: tuple[Requirement, ...] = field(default_factory=tuple)

    @property
    def allowed(self) -> bool:
        return all(r.met for r in self.requirements)

    @property
    def blocked_by(self) -> str | None:
        for r in self.requirements:
            if not r.met:
                return r.message
        return None


def _submit(f: ProjectFacts) -> Transition:
    """Assembly is finished and the DPO is being asked to review.

    Every requirement here is one the *author* can satisfy alone, in the order
    somebody assembling a project would hit them: write the notice, attach
    purposes to it, complete Rule 3, say who it addresses, write the text, then
    get the approval signed off.

    Legal approval of that text is not among them on purpose. It is the DPO's
    act, and requiring it here left the author waiting on somebody who could not
    see the project yet. It gates `pending_approval -> approved` instead.
    """
    return Transition(
        to=ProjectStatus.PENDING_APPROVAL,
        actors=frozenset({Role.RND_USER}),
        requirements=(
            Requirement(f.has_notice, "The project has no notice"),
            Requirement(
                f.notice_purpose_count >= 1,
                "The notice has no purposes attached",
            ),
            Requirement(
                f.notice_rule3_complete,
                "The notice is missing required Rule 3 elements",
            ),
            Requirement(
                f.notice_audience_set,
                "The notice does not say who it applies to",
            ),
            Requirement(
                f.notice_language_count >= 1,
                "The notice has no text yet - add at least one language",
            ),
            Requirement(
                f.approval_with_proof_count >= 1,
                "No approval with a proof file",
            ),
        ),
    )


def _transitions(status: ProjectStatus, f: ProjectFacts) -> list[Transition]:
    """Every transition out of `status`, with its preconditions evaluated."""
    match status:
        case ProjectStatus.IN_DRAFT:
            return [_submit(f)]

        case ProjectStatus.UNDER_PROCESS:
            # Unreachable, and offered the same way out as `in_draft` rather than
            # nothing. A row that somehow arrives here - a replayed history, an
            # older client - should be able to move forward, not be stranded in a
            # state with no exits.
            return [_submit(f)]

        case ProjectStatus.PENDING_APPROVAL:
            return [
                Transition(
                    to=ProjectStatus.APPROVED,
                    actors=frozenset({Role.DPO}),
                    publishes_notice=True,
                    requirements=(
                        # First, because it is the one the DPO can act on and the
                        # one that would otherwise fail mid-transaction: approving
                        # the project publishes the notice, and publication
                        # refuses text nobody has approved. Stated here it is a
                        # disabled button with a reason; left to publication it is
                        # an error after the click.
                        Requirement(
                            f.notice_language_approved,
                            "The notice text is not legally approved - approve every "
                            "language on the notice first",
                        ),
                        Requirement(f.review_recorded, "The DPO review is not recorded"),
                    ),
                ),
                Transition(
                    to=ProjectStatus.IN_DRAFT,
                    actors=frozenset({Role.DPO}),
                    reason_required=True,
                ),
            ]

        case ProjectStatus.APPROVED:
            return [
                Transition(
                    to=ProjectStatus.CLOSED,
                    actors=frozenset({Role.DPO}) | COLLECTION_OWNERS,
                )
            ]

        case ProjectStatus.CLOSED:
            # Terminal. A closed project that can be reopened is a project whose
            # consent links can be reactivated after the population was told the
            # collection had ended.
            return []


def available(
    status: ProjectStatus | str, role: Role | str, facts: ProjectFacts
) -> list[dict[str, object]]:
    """The payload behind GET /projects/{uuid}/transitions.

    Returns only transitions this *role* may attempt, each annotated with whether
    it is currently allowed and what is blocking it. Without this the frontend
    either hardcodes the state machine - which will drift from the backend - or
    shows buttons that fail on click.
    """
    st = ProjectStatus(status)
    r = Role(role)
    out: list[dict[str, object]] = []
    for t in _transitions(st, facts):
        if r not in t.actors:
            continue
        entry: dict[str, object] = {"to": t.to.value, "allowed": t.allowed}
        if t.blocked_by:
            entry["blocked_by"] = t.blocked_by
        if t.reason_required:
            entry["reason_required"] = True
        if t.publishes_notice:
            entry["publishes_notice"] = True
        out.append(entry)
    return out


def validate(
    *,
    current: ProjectStatus | str,
    target: ProjectStatus | str,
    role: Role | str,
    facts: ProjectFacts,
    reason: str | None = None,
) -> Transition:
    """Authorise one transition or raise. The single gate every write goes through.

    Ordering is deliberate. "That transition does not exist" comes before "you may
    not perform it", which comes before "its preconditions are unmet" - so the
    error a caller sees names the first thing they need to fix, and an
    unauthorised caller learns nothing about the project's readiness.
    """
    st, tgt, r = ProjectStatus(current), ProjectStatus(target), Role(role)

    match = next((t for t in _transitions(st, facts) if t.to is tgt), None)
    if match is None:
        raise TransitionNotPermitted(
            f"There is no transition from {st.value} to {tgt.value}",
            details={"from": st.value, "to": tgt.value},
        )

    if r not in match.actors:
        raise TransitionNotPermitted(
            f"{r.value} may not move a project from {st.value} to {tgt.value}",
            code="transition_role_not_permitted",
            details={
                "from": st.value,
                "to": tgt.value,
                "permitted_roles": sorted(a.value for a in match.actors),
            },
        )

    if not match.allowed:
        raise TransitionNotPermitted(
            match.blocked_by or "Preconditions are not met",
            code="transition_blocked",
            details={"from": st.value, "to": tgt.value},
        )

    if match.reason_required and not (reason or "").strip():
        raise TransitionNotPermitted(
            "A reason is required to return this project to draft",
            code="reason_required",
            field="reason",
        )

    return match


def creation_requirements(
    *, name: str | None, description: str | None, processor_count: int
) -> list[str]:
    """Preconditions for the implicit `- -> in_draft` transition.

    A nominated DCO used to be required here and is not any more. Who collects is
    now the question asked at creation - the processor - and who is accountable
    follows from the data sources chosen under it, which nobody can know yet. An
    R&D User picking a DCO on day one was picking on behalf of a decision that
    had not been made.
    """
    missing: list[str] = []
    if not (name or "").strip():
        missing.append("project_name is required")
    if not (description or "").strip():
        missing.append("description is required")
    if processor_count < 1:
        missing.append("at least one processor is required")
    return missing


# Every state the machine knows, for /meta/enums and for tests that assert the
# set has not quietly grown.
ALL_STATUSES: tuple[str, ...] = tuple(s.value for s in ProjectStatus)

#: The states a project can actually be in. `ALL_STATUSES` still carries
#: `under_process` because history rows name it; a status filter offered to a
#: user should not.
REACHABLE_STATUSES: tuple[str, ...] = tuple(
    s.value for s in ProjectStatus if s is not ProjectStatus.UNDER_PROCESS
)
