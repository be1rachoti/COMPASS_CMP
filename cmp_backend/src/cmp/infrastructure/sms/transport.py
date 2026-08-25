"""Where an SMS actually goes.

The same shape as the email transport, and separate for a reason that is not
symmetry: a data subject signing in with a mobile number gets their one-time
code this way, and SMS has failure modes email does not — silent drops, carrier
filtering, per-country delivery rules. Keeping it a distinct seam means a
deployment can use a real SMS provider without touching how email is sent, and
an SMS outage cannot take email down with it.
"""

from __future__ import annotations

from typing import Protocol, runtime_checkable

from cmp.core.config import settings
from cmp.core.logging import get_logger
from cmp.infrastructure.email.transport import obscure

log = get_logger("cmp.infrastructure.sms")


@runtime_checkable
class SmsTransport(Protocol):
    def send(self, *, to: str, body: str) -> dict[str, object]:
        """Deliver, or raise. Failure is an exception, never a return value."""
        ...


class ConsoleSmsTransport:
    """Development. Writes to the same outbox the email transport uses.

    One file rather than two: a developer completing a sign-in does not care
    which channel the code came over, and hunting across two files for it is
    exactly the friction this exists to remove.
    """

    def __init__(self, outbox_path: str | None = None) -> None:
        from pathlib import Path

        self._path = (
            Path(outbox_path) if outbox_path else Path(settings.upload_root).parent / "outbox.log"
        )

    def send(self, *, to: str, body: str) -> dict[str, object]:
        if not (settings.is_production or settings.environment == "staging"):
            try:
                from datetime import UTC, datetime

                self._path.parent.mkdir(parents=True, exist_ok=True)
                stamp = datetime.now(UTC).isoformat(timespec="seconds")
                with self._path.open("a", encoding="utf-8") as handle:
                    handle.write(f"\n{'=' * 78}\n{stamp}  [sms]  to: {to}\n{'-' * 78}\n{body}\n")
            except OSError as exc:  # pragma: no cover
                log.warning("sms.outbox_unavailable", error=str(exc))

        log.info("sms.delivered", to=obscure(to), transport="console")
        return {"channel": "sms", "transport": "console", "delivered": True}


class NullSmsTransport:
    """Accepts and discards, keeping what it was given for assertions."""

    def __init__(self) -> None:
        self.sent: list[dict[str, str]] = []

    def send(self, *, to: str, body: str) -> dict[str, object]:
        self.sent.append({"to": to, "body": body})
        return {"channel": "sms", "transport": "null", "delivered": True}


def build_sms_transport() -> SmsTransport:
    """Console unless configured otherwise — the same reasoning as email.

    A gateway that starts texting real numbers because an environment variable
    was missing is a worse outcome than one that quietly writes to a file.
    """
    if settings.sms_transport == "null":
        return NullSmsTransport()
    return ConsoleSmsTransport()
