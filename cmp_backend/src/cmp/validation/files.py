"""Upload validation.

Two upload paths exist — an approval proof and an import manifest — and both are
input we trust least: one arrives from a researcher's laptop, the other from a
third-party capture tool.

Checks run in this order, and the order is the point: refuse on declared size
before reading, refuse on actual size before hashing, refuse on type before
parsing. Each step is cheaper than the one it protects.
"""

from __future__ import annotations

from dataclasses import dataclass

from cmp.core.errors import BadRequest, ValidationFailed


@dataclass(frozen=True, slots=True)
class UploadRules:
    """What one upload slot accepts."""

    field: str
    max_bytes: int
    allowed_mime: tuple[str, ...]
    #: Extensions kept on the stored file. Anything else becomes `.bin`, so a
    #: `.php` or `.exe` cannot be written to disk under its own name whatever
    #: the client called it.
    allowed_suffixes: tuple[str, ...]


PROOF = UploadRules(
    field="proof",
    max_bytes=25 * 1024 * 1024,
    allowed_mime=("application/pdf", "image/png", "image/jpeg"),
    allowed_suffixes=(".pdf", ".png", ".jpg", ".jpeg"),
)

MANIFEST = UploadRules(
    field="manifest",
    max_bytes=25 * 1024 * 1024,
    allowed_mime=("text/csv", "application/csv", "text/plain"),
    allowed_suffixes=(".csv", ".txt"),
)


def check_upload(payload: bytes, content_type: str | None, rules: UploadRules) -> None:
    """Refuse an upload that breaks the rules, naming the field that failed.

    Raises rather than returning a verdict: there is no caller that wants to
    continue with a file it has been told is unacceptable, and a boolean return
    is one forgotten `if` away from writing it anyway.
    """
    if not payload:
        raise ValidationFailed(f"The {rules.field} is empty", field=rules.field)

    if len(payload) > rules.max_bytes:
        raise BadRequest(
            f"{rules.field.capitalize()} exceeds {rules.max_bytes // (1024 * 1024)} MB",
            code="payload_too_large",
            field=rules.field,
        )

    if content_type not in rules.allowed_mime:
        raise ValidationFailed(
            f"{rules.field.capitalize()} must be one of: {', '.join(rules.allowed_mime)}",
            field=rules.field,
        )


def safe_suffix(filename: str | None, rules: UploadRules) -> str:
    """The extension we are willing to store this file under.

    The client's filename is a suggestion, not an instruction. Anything outside
    the allow-list becomes `.bin` — the file is still stored, still hashed and
    still downloadable, it simply cannot claim to be something executable.
    """
    if not filename or "." not in filename:
        return ".bin"
    suffix = "." + filename.rsplit(".", 1)[-1].lower()
    return suffix if suffix in rules.allowed_suffixes else ".bin"
