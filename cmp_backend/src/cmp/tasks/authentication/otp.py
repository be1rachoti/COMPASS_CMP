"""Delivering the codes somebody is waiting for.

All four route to `high_priority`, and that queue exists for exactly this.
Somebody is looking at a code entry box right now; a code queued behind a
document export is a failed sign-in and a support call.

These use `dispatch_required`, not `dispatch_optional` — if the broker is
unreachable the request fails with a 503 rather than returning 200 and leaving
the user waiting for a message that will never arrive.
"""

from __future__ import annotations

from typing import Any

from celery import shared_task

from cmp.core.config import settings
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


@shared_task(name="cmp.notifications.send_mfa_code", **RETRY_KW)
def send_mfa_code(user_uuid: str, email: str, code: str) -> dict[str, Any]:
    return _deliver(
        channel="email",
        to=email,
        subject="Your verification code",
        body=(
            f"Your verification code is {code}. "
            f"It expires in {settings.mfa_ttl_s // 60} minutes. "
            "If you did not try to sign in, tell the Privacy Office."
        ),
    )


@shared_task(name="cmp.notifications.send_login_code", **RETRY_KW)
def send_login_code(user_uuid: str, contact: str, code: str) -> dict[str, Any]:
    channel = "email" if "@" in contact else "sms"
    return _deliver(
        channel=channel,
        to=contact,
        subject="Your sign-in code",
        body=(
            f"Your sign-in code is {code}. "
            f"It expires in {settings.otp_ttl_s // 60} minutes."
        ),
    )


@shared_task(name="cmp.notifications.send_consent_code", **RETRY_KW)
def send_consent_code(contact: str, code: str) -> dict[str, Any]:
    channel = "email" if "@" in contact else "sms"
    return _deliver(
        channel=channel,
        to=contact,
        subject="Confirm your contact details",
        body=(
            f"Your confirmation code is {code}. "
            f"It expires in {settings.otp_ttl_s // 60} minutes."
        ),
    )


@shared_task(name="cmp.notifications.send_password_reset", **RETRY_KW)
def send_password_reset(user_uuid: str, email: str, code: str) -> dict[str, Any]:
    return _deliver(
        channel="email",
        to=email,
        subject="Reset your password",
        body=f"Your password reset code is {code}. It expires in 15 minutes.",
    )
