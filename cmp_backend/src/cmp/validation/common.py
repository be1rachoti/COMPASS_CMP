"""Validation that is not about one field.

Three kinds of check live in this codebase, and keeping them apart is what stops
each from being done in the wrong place:

* **Shape** — is this a string of the right length, a uuid, an http URL. Pydantic
  does it, at the boundary, from the types in this package. Never reaches a
  service.
* **Rule** — may this project move to that state, is this purpose still
  attachable. The domain does it, because it needs the current row to decide.
* **Invariant** — can this row exist at all. The database does it, with a CHECK
  or a trigger, because it must hold for a write that never went through Python.

This module holds the small shape-level helpers that are shared across more than
one schema and would otherwise be copy-pasted.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from cmp.core.errors import ValidationFailed


def require_aware(value: datetime, *, field: str) -> datetime:
    """Reject a naive datetime rather than guessing at its zone.

    Every timestamp in this system is tz-aware — `DTZ` is enabled in ruff for
    the same reason. A naive datetime arriving from a client is not "probably
    UTC"; it is a value whose meaning nobody knows, and storing it invents an
    hour offset that will be wrong twice a year.
    """
    if value.tzinfo is None:
        raise ValidationFailed(
            "Timestamp must carry a timezone offset (e.g. 2026-01-31T09:00:00+05:30)",
            field=field,
        )
    return value


def require_future(value: datetime, *, field: str) -> datetime:
    """For an expiry somebody is setting now.

    A consent link that expires in the past is not an error the database can
    catch — the column is perfectly happy — but it is certainly not what the
    person filling in the form meant.
    """
    require_aware(value, field=field)
    if value <= datetime.now(UTC):
        raise ValidationFailed("That moment has already passed", field=field)
    return value


def require_non_empty[T](values: list[T], *, field: str, noun: str) -> list[T]:
    """A list that must have at least one member.

    Worth a helper because the failure mode is subtle: PostgreSQL's
    `array_length(x, 1)` returns NULL for an empty array, `NULL >= 1` is NULL,
    and a CHECK constraint passes on NULL. A constraint written that way admits
    exactly what it was added to forbid — which is the defect migration 0004
    fixes with `cardinality()`. Checking here as well means the caller gets a
    422 naming the field instead of a constraint violation.
    """
    if not values:
        raise ValidationFailed(f"At least one {noun} is required", field=field)
    return values


def reject_unknown_keys(payload: dict[str, Any], known: set[str], *, field: str) -> None:
    """For the few places a raw dict crosses the boundary.

    Pydantic's `extra="forbid"` covers every declared model. This is for the
    handful of endpoints that accept a free-form object, where silently ignoring
    an unexpected key is how a filter that was meant to narrow a result set
    quietly stops narrowing it.
    """
    unknown = sorted(set(payload) - known)
    if unknown:
        raise ValidationFailed(
            f"Unknown field(s): {', '.join(unknown)}. Accepted: {', '.join(sorted(known))}",
            field=field,
        )


def normalise_login(value: str) -> str:
    """Fold a sign-in identifier for comparison.

    People type their address with whatever capitalisation their keyboard
    produced, and a sign-in that fails on case is a support ticket rather than a
    security control. The stored value keeps its original case; only the
    comparison is folded.
    """
    return value.strip().lower()
