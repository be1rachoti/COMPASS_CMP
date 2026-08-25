# ruff: noqa: E501 - the transition table below is transcribed from DATA-MODEL.md.
# Re-wrapping it to 100 columns would make it unreadable, and an unreadable copy
# of a specification is worse than no copy.
"""The project state machine.

Five states, six transitions, and nothing else. From DATA-MODEL.md:

| From                              | To                 | Actor       | Requires                                              |
|-----------------------------------|--------------------|-------------|-------------------------------------------------------|
| -                                 | `in_draft`         | RnD User    | name, description, nominated DCO                      |
| `in_draft`                        | `under_process`    | DPO         | notice with >=1 purpose, all Rule 3 links; publishes  |
| `under_process`                   | `pending_approval` | RnD User    | >=1 project_approval **with proof file**              |
| `pending_approval`                | `approved`         | DPO         | review recorded                                       |
| `under_process`/`pending_approval`| `in_draft`         | DPO         | a reason                                              |
| `approved`                        | `closed`           | DPO or DCO  | -                                                     |

There is no path from `in_draft` to `approved`, and none back from `approved`
except to `closed`.

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
    UNDER_PROCESS = "under_process"
    PENDING_APPROVAL = "pending_approval"
    APPROVED = "approved"
    CLOSED = "closed"


@dataclass(frozen=True, slots=True)
class ProjectFacts:
    """What the domain needs to know to answer "may this move?".

    Assembled by the service from one query. Deliberately a value object: the
    state machine must not be able to reach back into the database and get a
    different answer halfway through a decision.
    """

    has_notice: bool = False
    notice_purpose_count: int = 0
    notice_rule3_complete: bool = False
    notice_published: bool = False
    approval_with_proof_count: int = 0
    has_dco: bool = False
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


def _transitions(status: ProjectStatus, f: ProjectFacts) -> list[Transition]:
    """Every transition out of `status`, with its preconditions evaluated."""
    match status:
        case ProjectStatus.IN_DRAFT:
            return [
                Transition(
                    to=ProjectStatus.UNDER_PROCESS,
                    actors=frozenset({Role.DPO}),
                    publishes_notice=True,
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
                    ),
                )
            ]

        case ProjectStatus.UNDER_PROCESS:
            return [
                Transition(
                    to=ProjectStatus.PENDING_APPROVAL,
                    actors=frozenset({Role.RND_USER}),
                    requirements=(
                        Requirement(
                            f.approval_with_proof_count >= 1,
                            "No approval with a proof file",
                        ),
                    ),
                ),
                Transition(
                    to=ProjectStatus.IN_DRAFT,
                    actors=frozenset({Role.DPO}),
                    reason_required=True,
                ),
            ]

        case ProjectStatus.PENDING_APPROVAL:
            return [
                Transition(
                    to=ProjectStatus.APPROVED,
                    actors=frozenset({Role.DPO}),
                    requirements=(
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
                    actors=frozenset({Role.DPO, Role.DCO}),
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
    *, name: str | None, description: str | None, dco_user_uuid: str | None
) -> list[str]:
    """Preconditions for the implicit `- -> in_draft` transition."""
    missing: list[str] = []
    if not (name or "").strip():
        missing.append("project_name is required")
    if not (description or "").strip():
        missing.append("description is required")
    if not (dco_user_uuid or "").strip():
        missing.append("a nominated DCO is required")
    return missing


# Every state the machine knows, for /meta/enums and for tests that assert the
# set has not quietly grown.
ALL_STATUSES: tuple[str, ...] = tuple(s.value for s in ProjectStatus)
