"""The project lifecycle.

A project is the unit everything else hangs off: notices belong to it, sites
belong to it, consent is given against its notice, and exports come out of it.

`state_machine.py` is the specification - a pure function over five states with
no I/O, which is why it carries the densest test file in the suite. `service.py`
is the only place `project.project_status` is written, and every write goes
through `validate()` first, records a history row, and writes an audit row in the
same transaction. A project can never be in a state its history does not explain.
"""

from cmp.domain.projects.service import (
    add_approval,
    add_site,
    assign_dco,
    close,
    create,
    transition,
    transitions_for,
    update_draft,
)
from cmp.domain.projects.state_machine import (
    ProjectFacts,
    ProjectStatus,
    available,
    creation_requirements,
    validate,
)

__all__ = [
    "ProjectFacts",
    "ProjectStatus",
    "add_approval",
    "add_site",
    "assign_dco",
    "available",
    "close",
    "create",
    "creation_requirements",
    "transition",
    "transitions_for",
    "update_draft",
    "validate",
]
