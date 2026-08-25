"""Domain exception hierarchy and the single error contract.

One shape for every failure, per the API reference §1.4:

    {"error": {"code", "message", "field", "request_id"}}

Handlers live in `cmp.api.errors`; nothing below the API layer touches Starlette.
"""

from __future__ import annotations

from typing import Any


class CmpError(Exception):
    """Base for everything the domain raises deliberately."""

    status_code: int = 500
    code: str = "internal_error"

    def __init__(
        self,
        message: str,
        *,
        code: str | None = None,
        field: str | None = None,
        details: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(message)
        self.message = message
        if code is not None:
            self.code = code
        self.field = field
        self.details = details or {}


class BadRequest(CmpError):
    status_code = 400
    code = "bad_request"


class UnknownFilter(BadRequest):
    """A filter parameter we do not recognise.

    Rejected, never ignored: a typo in a filter that silently returns everything
    is how the wrong people see the wrong rows.
    """

    code = "unknown_filter"


class Unauthenticated(CmpError):
    status_code = 401
    code = "unauthenticated"


class MfaRequired(CmpError):
    status_code = 401
    code = "mfa_required"


class Forbidden(CmpError):
    """Authenticated, visible to this user, but not permitted to act.

    Reserve this for a resource the user *can see*. A resource outside their scope
    raises NotFound — a 403 confirms the row exists.
    """

    status_code = 403
    code = "forbidden"


class NotFound(CmpError):
    status_code = 404
    code = "not_found"

    def __init__(self, entity: str = "Resource", **kw: Any) -> None:
        super().__init__(f"{entity} not found", **kw)


class Conflict(CmpError):
    """State conflict — most often a transition that is not permitted."""

    status_code = 409
    code = "conflict"


class TransitionNotPermitted(Conflict):
    code = "transition_not_permitted"


class ValidationFailed(CmpError):
    status_code = 422
    code = "validation_failed"


class RateLimited(CmpError):
    status_code = 429
    code = "rate_limited"

    def __init__(self, message: str = "Too many requests", retry_after_s: int = 60) -> None:
        super().__init__(message, details={"retry_after_s": retry_after_s})
        self.retry_after_s = retry_after_s


class ServiceUnavailable(CmpError):
    status_code = 503
    code = "service_unavailable"


class UpstreamError(CmpError):
    status_code = 502
    code = "upstream_error"


# --------------------------------------------------------------------- domain
class NoticeIncomplete(ValidationFailed):
    code = "notice_incomplete"


class NoticeImmutable(Conflict):
    code = "notice_immutable"


class PurposeInUse(Conflict):
    code = "purpose_in_use"


class LinkInvalid(CmpError):
    """A consent link that is expired, revoked, exhausted or unknown.

    One code for all four. Distinguishing them tells a token-guesser which of
    their guesses was structurally valid.
    """

    status_code = 404
    code = "link_invalid"

    def __init__(self, message: str = "This link is not valid") -> None:
        super().__init__(message)


class ConsentDefective(ValidationFailed):
    """s.5(1): the notice must be served before or with the request for consent."""

    code = "consent_defective"


class ImportRejected(ValidationFailed):
    code = "import_rejected"


class AuditImmutable(Forbidden):
    code = "audit_immutable"
