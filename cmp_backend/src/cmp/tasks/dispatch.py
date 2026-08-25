"""Queuing a task, and deciding what happens when the broker is unreachable.

The naive `task.delay(...)` inside a request handler couples the endpoint's
availability to the broker's. That is right for some work and badly wrong for
most, so the choice is made explicitly per call site rather than by accident:

* `dispatch_required` - the task *is* the outcome. An MFA code that was never
  queued means the user cannot sign in, so the honest answer is 503 with a
  message telling them to try again, not a 500 that reads like a bug.

* `dispatch_optional` - the task is a side effect of something that already
  succeeded. A consent artefact is written and committed; failing the request
  because the receipt could not be queued would tell the user their consent was
  not recorded, which is false, and would invite them to submit it again.

Both log. A dropped notification that nobody can see is the failure mode this
module exists to prevent.
"""

from __future__ import annotations

from typing import Any

from cmp.core.context import current_context
from cmp.core.errors import ServiceUnavailable
from cmp.core.logging import get_logger

log = get_logger("cmp.tasks.dispatch")

# kombu raises a wide family of connection errors, and the concrete classes vary
# by transport. Catching broadly here is deliberate: the point is that *no*
# broker problem should escape as an unhandled exception.
BROKER_ERRORS: tuple[type[BaseException], ...] = (OSError, ConnectionError, TimeoutError)


def _headers() -> dict[str, Any]:
    """Carry the correlation id into the worker so one id spans both halves."""
    return {"request_id": current_context().request_id}


def dispatch_required(task: Any, *args: Any, **kwargs: Any) -> str | None:
    """Queue work the caller cannot succeed without."""
    try:
        result = task.apply_async(args=args, kwargs=kwargs, headers=_headers())
    except Exception as exc:
        log.error("task.dispatch_failed", task=task.name, required=True, error=str(exc))
        raise ServiceUnavailable(
            "We could not send that message just now. Please try again in a moment."
        ) from exc
    log.info("task.queued", task=task.name, task_id=result.id, required=True)
    return str(result.id)


def dispatch_optional(task: Any, *args: Any, **kwargs: Any) -> str | None:
    """Queue work that must not fail the request it belongs to."""
    try:
        result = task.apply_async(args=args, kwargs=kwargs, headers=_headers())
    except Exception as exc:
        # Logged at error, not warning: somebody expected a message and will not
        # get one, and that needs to reach an alert rather than a debug session.
        log.error("task.dispatch_failed", task=task.name, required=False, error=str(exc))
        return None
    log.info("task.queued", task=task.name, task_id=result.id, required=False)
    return str(result.id)
