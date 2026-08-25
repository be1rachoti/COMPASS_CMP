"""Rejecting query parameters nobody declared.

An unknown filter is **refused, never ignored**. That is a deliberate and
slightly unusual choice, and it is worth stating why.

The failure this prevents: somebody calls `/consents?status=withdrawn` against
an endpoint whose parameter is actually named `consent_status`. Ignoring the
unknown key returns *every* consent with a 200, and the caller has no way to
tell that their filter did nothing. In a system whose job is to say who
consented to what, silently returning a wider set than was asked for is the
worst possible way to be wrong.

So: 400, naming both the unknown parameter and the accepted ones.
"""

from __future__ import annotations

from collections.abc import Iterable

from fastapi import Request

from cmp.core.errors import UnknownFilter


def reject_unknown_filters(request: Request, known: Iterable[str]) -> None:
    """Unknown query parameters are a 400, never ignored.

    A typo in a filter that silently returns everything is how the wrong people
    see the wrong rows (API reference §1.3).
    """

    permitted = set(known) | {"limit", "cursor", "sort"}
    unknown = sorted(set(request.query_params) - permitted)
    if unknown:
        raise UnknownFilter(
            f"Unknown query parameter(s): {', '.join(unknown)}",
            field=unknown[0],
            details={"allowed": sorted(permitted)},
        )
