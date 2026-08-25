"""One error contract for every route.

Whatever fails — a domain rule, a Pydantic model, the framework, or something
nobody anticipated — the body has the same shape and carries the request id.
A client writes one parser; a support conversation starts with one string.

`responses` builds the body, `handlers` maps exceptions onto it, and `mapping`
asserts at import that every domain exception declares the status and code it
will be served with.
"""

from __future__ import annotations

from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from starlette.exceptions import HTTPException as StarletteHTTPException

from cmp.api.errors.handlers import (
    cmp_error_handler,
    http_exception_handler,
    unhandled_handler,
    validation_handler,
)
from cmp.api.errors.mapping import STATUS_BY_EXCEPTION, verify_mapping
from cmp.api.errors.responses import error_body, response
from cmp.core.errors import CmpError

__all__ = [
    "STATUS_BY_EXCEPTION",
    "cmp_error_handler",
    "error_body",
    "http_exception_handler",
    "install",
    "response",
    "unhandled_handler",
    "validation_handler",
    "verify_mapping",
]


def install(app: FastAPI) -> None:
    """Register the handlers, most specific first.

    `Exception` is registered last and deliberately: it is the backstop, and a
    handler registered after it would never be reached.
    """
    app.add_exception_handler(CmpError, cmp_error_handler)
    app.add_exception_handler(RequestValidationError, validation_handler)
    app.add_exception_handler(StarletteHTTPException, http_exception_handler)
    app.add_exception_handler(Exception, unhandled_handler)
