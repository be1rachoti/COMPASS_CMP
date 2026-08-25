"""Capture and withdrawal.

The part of the system that has to be right. Three properties are enforced here
rather than trusted:

* **served_at is server-stamped.** It evidences s.5(1) - that the notice was
  given before consent was asked for - and a client-supplied timestamp would
  make that unfalsifiable.
* **Consent is captured per purpose.** One grant row each, never a count.
* **Withdrawal supersedes; it never edits.** The earlier artefact survives as
  evidence of what was agreed at the time, and the database refuses an UPDATE on
  it in any case.
"""

from cmp.domain.consent.service import (
    capture,
    create_link,
    register_subject,
    resolve_link,
    send_contact_code,
    serve_notice,
    verify_contact_code,
    withdraw,
)

__all__ = [
    "capture",
    "create_link",
    "register_subject",
    "resolve_link",
    "send_contact_code",
    "serve_notice",
    "verify_contact_code",
    "withdraw",
]
