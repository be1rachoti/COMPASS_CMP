"""Sending an email, as the rest of the system sees it.

One object with one job: take a template's output and hand it to whatever
transport this environment is configured for. Callers name a message
(`send_mfa_code`), never a transport.

The service is deliberately thin. Retry, backoff and queue routing belong to
Celery and live in `cmp.tasks`; putting them here would mean two retry policies
disagreeing about how many attempts is too many.
"""

from __future__ import annotations

from functools import lru_cache
from typing import Any

from cmp.infrastructure.email import templates
from cmp.infrastructure.email.transport import EmailTransport, build_email_transport


class EmailService:
    """Named messages over a transport.

    Takes the transport by injection so a test can pass `NullEmailTransport`
    and assert on what would have been sent, without monkeypatching a module.
    """

    def __init__(self, transport: EmailTransport | None = None) -> None:
        self._transport = transport or build_email_transport()

    # ------------------------------------------------------- authentication
    def send_mfa_code(self, to: str, code: str) -> dict[str, Any]:
        subject, body = templates.mfa_code(code)
        return dict(self._transport.send(to=to, subject=subject, body=body))

    def send_login_code(self, to: str, code: str) -> dict[str, Any]:
        subject, body = templates.login_code(code)
        return dict(self._transport.send(to=to, subject=subject, body=body))

    def send_consent_code(self, to: str, code: str, project_name: str) -> dict[str, Any]:
        subject, body = templates.consent_code(code, project_name)
        return dict(self._transport.send(to=to, subject=subject, body=body))

    def send_password_reset(self, to: str, token_url: str) -> dict[str, Any]:
        subject, body = templates.password_reset(token_url)
        return dict(self._transport.send(to=to, subject=subject, body=body))

    # -------------------------------------------------------- consent record
    def send_consent_receipt(
        self, to: str, project_name: str, purposes: list[str], withdraw_url: str
    ) -> dict[str, Any]:
        subject, body = templates.consent_receipt(project_name, purposes, withdraw_url)
        return dict(self._transport.send(to=to, subject=subject, body=body))

    def send_withdrawal_confirmation(
        self, to: str, project_name: str, withdrawn: list[str]
    ) -> dict[str, Any]:
        subject, body = templates.withdrawal_confirmation(project_name, withdrawn)
        return dict(self._transport.send(to=to, subject=subject, body=body))


@lru_cache(maxsize=1)
def email_service() -> EmailService:
    """The process-wide instance.

    Cached because building a transport may open a connection pool, and a Celery
    worker handling a thousand notifications should not build a thousand of them.
    """
    return EmailService()
