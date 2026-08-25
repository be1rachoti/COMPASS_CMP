"""The authenticated caller.

Resolved once per request and passed down. Everything below the API layer that
needs to know *who is asking* takes one of these rather than reaching for the
request object — which is what lets a service be called from a Celery task or a
script without inventing a fake HTTP request.

Deliberately small. A `Principal` is identity plus role plus the session that
proved it, and nothing else. It is not a user record: adding the person's email
here would put a copy of a mutable row in every request context, and the copy
would be stale the moment somebody changed it.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING

from cmp.core.permissions import Role, Scope, scope_of

if TYPE_CHECKING:  # pragma: no cover
    from cmp.auth.sessions.service import Session


@dataclass(frozen=True, slots=True)
class Principal:
    """Who is making this request, and what proved it.

    Frozen: a principal resolved at the start of a request must not be editable
    partway through it. Code that could widen its own role mid-request is code
    that will, eventually, by accident.
    """

    user_id: int
    uuid: str
    role: Role
    session: Session

    def scope_for(self, resource: str) -> Scope:
        """How far this caller sees inside a resource.

        A convenience over the table, not a decision — `authorize()` is what
        decides, and it is what logs the denial. This is for a service that has
        already been permitted and needs the scope to build its query.
        """
        return scope_of(resource, self.role)

    @property
    def is_staff(self) -> bool:
        """Anyone who is not a data subject.

        Phrased as a negative on purpose: there are four staff roles and one
        subject role, and a new staff role added later should be staff by
        default rather than silently excluded from every `is_staff` check.
        """
        return self.role is not Role.DATA_SUBJECT

    @property
    def is_subject(self) -> bool:
        return self.role is Role.DATA_SUBJECT
