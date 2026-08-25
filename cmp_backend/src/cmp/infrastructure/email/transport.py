"""Where an email actually goes.

One protocol, three implementations, chosen by configuration. The point of the
seam is that everything above it — the templates, the tasks, the retry policy —
is written once and does not change when the transport does.

Whatever a deployment plugs in here must keep four properties, and they are
properties of the *transport*, not of the caller:

* **An explicit timeout.** Never infinite. A hung SMTP connection holds a worker
  slot until somebody notices, and nobody notices.
* **No secret in the log.** The code being delivered is never logged — that is
  the entire point of storing it as a keyed hash — and the recipient is
  obscured. What is logged is that a delivery happened, to roughly whom.
* **Raise on failure.** The Celery task carries the retry policy. A transport
  that swallows an error and returns quietly turns a retryable outage into
  silent data loss.
* **Idempotence is not assumed.** `acks_late` means a task can be redelivered,
  so a transport must tolerate being asked to send the same message twice.
"""

from __future__ import annotations

from typing import Protocol, runtime_checkable

from cmp.core.config import settings
from cmp.core.logging import get_logger

log = get_logger("cmp.infrastructure.email")


@runtime_checkable
class EmailTransport(Protocol):
    """The one method anything above this layer may call."""

    def send(self, *, to: str, subject: str, body: str) -> dict[str, object]:
        """Deliver, or raise.

        The return value is for the task's result backend and the audit log —
        it says what happened, not whether it worked. Failure is an exception.
        """
        ...


def obscure(contact: str) -> str:
    """Enough of a recipient to answer "did it go out", not enough to be a list.

    An access log that records full addresses is a contact database with extra
    steps, and it will be read by more people than the address book would be.
    """
    if "@" in contact:
        name, _, domain = contact.partition("@")
        head = name[:2] if len(name) > 2 else name[:1]
        return f"{head}***@{domain}"
    return f"***{contact[-3:]}" if len(contact) > 3 else "***"


class ConsoleEmailTransport:
    """Development. Writes to a local outbox file and logs the fact.

    This exists because one-time codes are deliberately absent from the logs,
    which makes the local sign-in loop impossible to complete without somewhere
    to read them. Same idea as running MailHog beside a dev stack, minus the
    container.

    Hard-gated on environment, twice: the guard runs before anything is
    formatted, so there is no code path where a production process assembles a
    plaintext file of verification codes and then decides not to write it.
    """

    def __init__(self, outbox_path: str | None = None) -> None:
        from pathlib import Path

        self._path = (
            Path(outbox_path)
            if outbox_path
            else Path(settings.upload_root).parent / "outbox.log"
        )

    def send(self, *, to: str, subject: str, body: str) -> dict[str, object]:
        self._write(to=to, subject=subject, body=body)
        log.info(
            "email.delivered",
            to=obscure(to),
            subject=subject,
            transport="console",
        )
        return {"channel": "email", "transport": "console", "delivered": True}

    def _write(self, *, to: str, subject: str, body: str) -> None:
        if settings.is_production or settings.environment == "staging":
            return
        try:
            from datetime import UTC, datetime

            self._path.parent.mkdir(parents=True, exist_ok=True)
            stamp = datetime.now(UTC).isoformat(timespec="seconds")
            entry = (
                f"\n{'=' * 78}\n"
                f"{stamp}  [email]  to: {to}\n"
                f"subject: {subject}\n{'-' * 78}\n{body}\n"
            )
            with self._path.open("a", encoding="utf-8") as handle:
                handle.write(entry)
        except OSError as exc:  # pragma: no cover — a convenience, never fatal
            log.warning("email.outbox_unavailable", error=str(exc))


class SmtpEmailTransport:
    """Production, via SMTP.

    Not wired by default: a deployment sets `EMAIL_TRANSPORT=smtp` and the SMTP
    settings, and `build_email_transport` returns this instead. Left explicit
    rather than auto-detected, because "it silently started emailing people" is
    not a surprise anybody wants.
    """

    def __init__(self, host: str, port: int, *, username: str = "", password: str = "",
                 use_tls: bool = True, timeout_s: float | None = None) -> None:
        self._host = host
        self._port = port
        self._username = username
        self._password = password
        self._use_tls = use_tls
        # Never infinite. A hung connection holds a worker slot indefinitely.
        self._timeout = timeout_s or settings.external_http_timeout_s

    def send(self, *, to: str, subject: str, body: str) -> dict[str, object]:
        import smtplib
        from email.message import EmailMessage

        message = EmailMessage()
        message["From"] = settings.notification_email_from
        message["To"] = to
        message["Subject"] = subject
        message.set_content(body)

        # Exceptions propagate on purpose: the task's retry policy is what
        # decides whether to try again, and it cannot decide if it is not told.
        with smtplib.SMTP(self._host, self._port, timeout=self._timeout) as client:
            if self._use_tls:
                client.starttls()
            if self._username:
                client.login(self._username, self._password)
            client.send_message(message)

        log.info("email.delivered", to=obscure(to), subject=subject, transport="smtp")
        return {"channel": "email", "transport": "smtp", "delivered": True}


class NullEmailTransport:
    """Accepts and discards. For tests that assert on behaviour, not delivery."""

    def __init__(self) -> None:
        self.sent: list[dict[str, str]] = []

    def send(self, *, to: str, subject: str, body: str) -> dict[str, object]:
        self.sent.append({"to": to, "subject": subject, "body": body})
        return {"channel": "email", "transport": "null", "delivered": True}


def build_email_transport() -> EmailTransport:
    """Pick the transport this environment is configured for.

    Defaults to the console outbox. A deployment that wants real mail says so
    explicitly — defaulting to SMTP would mean a misconfigured staging box
    emailing real people the first time somebody signs in.
    """
    if settings.email_transport == "smtp":
        return SmtpEmailTransport(
            host=settings.smtp_host,
            port=settings.smtp_port,
            username=settings.smtp_username,
            # Unwrapped at the last possible moment. SecretStr keeps it out of
            # reprs, tracebacks and structlog output everywhere above this line.
            password=settings.smtp_password.get_secret_value(),
            use_tls=settings.smtp_use_tls,
        )
    if settings.email_transport == "null":
        return NullEmailTransport()
    return ConsoleEmailTransport()
