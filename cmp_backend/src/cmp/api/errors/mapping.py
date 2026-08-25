"""Which exception becomes which status.

Split out so the mapping can be read as a table rather than inferred from four
handler bodies. The domain exceptions carry their own `status_code`, so this is
mostly documentation of what those are — but documentation that is *executed*,
because `verify_mapping()` asserts at import that every exception in the
hierarchy has one.

The two entries worth defending:

* **`NotFound` for anything outside scope, never `Forbidden`.** A 403 confirms
  the row exists, which is the fact the scope was meant to withhold. Only a
  resource the caller can see but may not act on gets a 403.
* **`Conflict` for a state-machine refusal, not `BadRequest`.** The request was
  well-formed; the system is simply not in a state where it can be honoured, and
  the difference tells the client whether retrying could ever help.
"""

from __future__ import annotations

from http import HTTPStatus

from cmp.core import errors as domain_errors

#: Exception name -> the status it produces. Derived from the classes rather than
#: duplicated, so this cannot drift from what the handlers actually return.
STATUS_BY_EXCEPTION: dict[str, int] = {
    name: int(getattr(cls, "status_code", HTTPStatus.INTERNAL_SERVER_ERROR))
    for name, cls in vars(domain_errors).items()
    if isinstance(cls, type)
    and issubclass(cls, domain_errors.CmpError)
    and cls is not domain_errors.CmpError
}


def verify_mapping() -> None:
    """Assert every domain exception declares a status and a code.

    Runs at import. An exception without a status falls through to 500, which
    turns a deliberate refusal into what looks like an outage — and the person
    who added it would not find out until it was raised in production.
    """
    missing: list[str] = []
    for name, cls in vars(domain_errors).items():
        if not (isinstance(cls, type) and issubclass(cls, domain_errors.CmpError)):
            continue
        if cls is domain_errors.CmpError:
            continue
        if not getattr(cls, "status_code", None) or not getattr(cls, "code", None):
            missing.append(name)

    if missing:
        raise RuntimeError(
            f"Domain exception(s) {sorted(missing)} declare no status_code/code. "
            "They would fall through to a 500, which reads as an outage rather "
            "than a refusal."
        )


verify_mapping()
