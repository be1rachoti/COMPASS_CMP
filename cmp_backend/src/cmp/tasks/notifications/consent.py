"""The consent receipt.

Often the only copy a data subject keeps of what they agreed to, which is why it
lists the purposes individually rather than a count, and why it carries the
withdrawal URL.

Dispatched with `dispatch_optional`: the consent is already recorded and the
artefact is the evidence. A broker outage must not fail the capture — losing the
courtesy email is recoverable, losing the consent is not.
"""

from __future__ import annotations

from typing import Any

from celery import shared_task

from cmp.core.logging import get_logger
from cmp.infrastructure.email import build_email_transport
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


@shared_task(name="cmp.notifications.send_consent_receipt", **RETRY_KW)
def send_consent_receipt(contact: str, consent_uuid: str, project_name: str) -> dict[str, Any]:
    """A receipt is not a courtesy; it is the subject's copy of the evidence.

    It carries the artefact reference so she can quote it when exercising a
    right, and it is what makes a later "I never consented to that" checkable by
    both sides.
    """
    return _deliver(
        channel="email" if "@" in contact else "sms",
        to=contact,
        subject=f"Your consent record for {project_name}",
        body=(
            f"Your consent has been recorded. Reference: {consent_uuid}. "
            "You can review or withdraw it at any time from your account."
        ),
    )
