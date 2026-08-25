"""Sending one message to many recipients.

Bounded by a soft time limit and reports partial delivery honestly rather than
raising on the first failure — a batch that stops at recipient three has still
delivered to two, and pretending otherwise would have them notified twice on the
retry.
"""

from __future__ import annotations

from typing import Any

from celery import shared_task
from celery.exceptions import SoftTimeLimitExceeded

from cmp.core.logging import get_logger
from cmp.infrastructure.email import build_email_transport
from cmp.infrastructure.email.transport import obscure
from cmp.infrastructure.sms import build_sms_transport

log = get_logger("cmp.tasks.notifications")

# Retry on transport failure with exponential backoff and jitter. Without jitter,
# a gateway outage produces a synchronised retry storm the moment it recovers.
RETRY_KW: dict[str, Any] = {
    "autoretry_for": (ConnectionError, TimeoutError, OSError),
    "retry_backoff": 5,
    "retry_backoff_max": 300,
    "retry_jitter": True,
    "max_retries": 5,
    "acks_late": True,
}


def _deliver(*, channel: str, to: str, subject: str, body: str) -> dict[str, Any]:
    """Hand a message to the transport this environment is configured for.

    The transport itself lives in `cmp.infrastructure` — swapping the console
    outbox for SMTP is a setting, not an edit here. What stays with the task is
    the retry policy, because Celery owns retries and two policies disagreeing
    about how many attempts is too many is worse than one.

    Failure propagates. A transport that swallowed an error and returned quietly
    would turn a retryable outage into silent data loss.
    """
    if channel == "sms":
        return dict(build_sms_transport().send(to=to, body=body))
    return dict(build_email_transport().send(to=to, subject=subject, body=body))


@shared_task(
    name="cmp.notifications.notify_project_event",
    bind=True,
    **RETRY_KW,
)
def notify_project_event(
    self: Any, recipients: list[str], subject: str, body: str
) -> dict[str, Any]:
    """Fan-out to staff for a workflow event - a queue item awaiting their action.

    Partial failure is reported rather than retried wholesale: retrying the whole
    batch would re-deliver to everyone who already received it.
    """
    delivered, failed = 0, []
    try:
        for address in recipients:
            try:
                _deliver(channel="email", to=address, subject=subject, body=body)
                delivered += 1
            except (ConnectionError, TimeoutError, OSError) as exc:
                failed.append({"to": obscure(address), "error": type(exc).__name__})
    except SoftTimeLimitExceeded:
        log.warning(
            "notification.batch_timed_out",
            delivered=delivered,
            remaining=len(recipients) - delivered,
        )
        raise

    if failed:
        log.warning("notification.batch_partial", delivered=delivered, failed=len(failed))
    return {"delivered": delivered, "failed": failed}
