"""The one error body, and how it is built.

Every failure this API produces looks the same on the wire:

    {"error": {"code": "...", "message": "...", "request_id": "...", "field": "..."}}

That is worth insisting on. A client that has to recognise four error shapes
writes four parsers and gets three of them wrong; a support conversation that
starts with a request id ends faster than one that starts with a screenshot.

`code` is the machine-readable half and is stable — clients branch on it.
`message` is the human half and may be reworded freely. Anything that would
branch on `message` is a bug in the client, and anything that would change a
`code` is a breaking change.
"""

from __future__ import annotations

from typing import Any

from fastapi.responses import ORJSONResponse

from cmp.core.context import current_context


def error_body(
    code: str,
    message: str,
    *,
    field: str | None = None,
    extra: dict[str, Any] | None = None,
) -> dict[str, Any]:
    body: dict[str, Any] = {
        "code": code,
        "message": message,
        "request_id": current_context().request_id,
    }
    if field:
        body["field"] = field
    if extra:
        body |= extra
    return {"error": body}


def response(
    status_code: int,
    code: str,
    message: str,
    *,
    field: str | None = None,
    extra: dict[str, Any] | None = None,
    headers: dict[str, str] | None = None,
) -> ORJSONResponse:
    return ORJSONResponse(
        status_code=status_code,
        content=error_body(code, message, field=field, extra=extra),
        headers=headers,
    )
