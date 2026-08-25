"""The words the system sends.

Kept out of the task bodies for one reason that is not tidiness: these are the
only messages a data subject receives from us, and they should be reviewable as
a set. Somebody changing the tone of a withdrawal confirmation should be able to
see it next to the consent receipt, not hunt for it inside a Celery task.

Plain text, not HTML. A one-time code that arrives as a rendering failure is a
sign-in nobody can complete, and these messages carry no branding worth the
risk.

Every template is a function returning `(subject, body)` rather than a format
string, so the caller cannot forget a placeholder and ship `{code}` to a user.
"""

from __future__ import annotations

from cmp.core.config import settings

_SIGN_OFF = "\n\nIf you were not expecting this, tell the Privacy Office."


def mfa_code(code: str) -> tuple[str, str]:
    minutes = settings.mfa_ttl_s // 60
    return (
        "Your verification code",
        f"Your verification code is {code}.\nIt expires in {minutes} minutes." + _SIGN_OFF,
    )


def login_code(code: str) -> tuple[str, str]:
    minutes = settings.otp_ttl_s // 60
    return (
        "Your sign-in code",
        f"Your sign-in code is {code}.\nIt expires in {minutes} minutes." + _SIGN_OFF,
    )


def consent_code(code: str, project_name: str) -> tuple[str, str]:
    minutes = settings.otp_ttl_s // 60
    return (
        "Confirm your contact details",
        f"Your confirmation code is {code}.\n"
        f"It expires in {minutes} minutes.\n\n"
        f"You are being asked to read a notice for: {project_name}.\n"
        "You have not agreed to anything yet — the code only confirms we can "
        "reach you." + _SIGN_OFF,
    )


def password_reset(token_url: str) -> tuple[str, str]:
    return (
        "Reset your password",
        f"Open this link to set a new password:\n\n{token_url}\n\n"
        "It can be used once, and it expires shortly." + _SIGN_OFF,
    )


def consent_receipt(project_name: str, purposes: list[str], withdraw_url: str) -> tuple[str, str]:
    """Sent after consent is captured.

    Lists the purposes individually rather than a count. "You agreed to 3
    purposes" is not a record of what somebody agreed to, and this message is
    often the only copy they keep.
    """
    lines = "\n".join(f"  - {name}" for name in purposes) or "  (none)"
    return (
        f"Your consent record — {project_name}",
        f"Thank you. We have recorded your consent for {project_name}.\n\n"
        f"You agreed to:\n{lines}\n\n"
        f"You can withdraw at any time, and it is as easy as giving consent was:\n"
        f"{withdraw_url}\n\n"
        "Withdrawing stops future processing for the purposes you withdraw. It "
        "does not by itself delete data already collected — ask for erasure if "
        "that is what you want.",
    )


def withdrawal_confirmation(project_name: str, withdrawn: list[str]) -> tuple[str, str]:
    lines = "\n".join(f"  - {name}" for name in withdrawn) or "  (all purposes)"
    return (
        f"Your withdrawal — {project_name}",
        f"We have recorded your withdrawal for {project_name}.\n\n"
        f"Withdrawn:\n{lines}\n\n"
        "Processing for these purposes stops now. The earlier record is kept as "
        "evidence of what was agreed at the time — it is not deleted, and it "
        "does not permit any further processing.",
    )
