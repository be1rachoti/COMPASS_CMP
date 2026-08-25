"""An outcome that carries more than the thing it produced.

Most service calls either succeed or raise — that is the right default, and this
module does not change it. Nothing here is a substitute for an exception, and a
service must not return `Result(ok=False)` where it should be raising: a caller
that forgets to check a boolean writes the row anyway, and a caller that forgets
to catch an exception at least fails loudly.

What this is for is the narrower case where a call **succeeded** and something
about *how* it succeeded matters to the caller:

* adding a site succeeded, and it was a material change requiring a new notice
  version;
* an import succeeded, and it was an idempotent replay that wrote nothing;
* a transition succeeded, and it published a notice as a side effect.

Returning a bare row loses that, and the alternatives are worse — an out
parameter, a second query to work it out, or the caller inferring it from a
timestamp.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass(frozen=True, slots=True)
class Outcome[T]:
    """A value, plus what the caller should know about how it was produced.

    Frozen because an outcome is a report of something that already happened.
    Mutating one after the fact would make it a lie.
    """

    value: T

    #: Things the caller should surface to the user but which are not errors.
    #: A notice needing a new version because a recipient was added is the
    #: canonical case: the write succeeded, and somebody has to act on it.
    warnings: tuple[str, ...] = ()

    #: Facts about the operation itself — `{"idempotent_replay": True}`,
    #: `{"published_notice_uuid": "…"}`. Kept out of `value` so the response
    #: model for the row does not have to grow a field describing the request.
    meta: dict[str, Any] = field(default_factory=dict)

    @property
    def has_warnings(self) -> bool:
        return bool(self.warnings)

    def with_warning(self, message: str) -> Outcome[T]:
        """A copy carrying one more warning.

        Returns a new instance rather than appending, so an outcome cannot be
        edited by a layer that merely passed it through.
        """
        return Outcome(value=self.value, warnings=(*self.warnings, message), meta=dict(self.meta))

    def with_meta(self, **entries: Any) -> Outcome[T]:
        return Outcome(value=self.value, warnings=self.warnings, meta={**self.meta, **entries})

    def as_response(self) -> dict[str, Any]:
        """Flatten for a router that returns a dict.

        `value` is spread when it is a mapping, so the endpoint's response model
        sees the row's own fields at the top level with the metadata beside
        them, rather than nested under a key every client would have to unwrap.
        """
        body: dict[str, Any] = dict(self.value) if isinstance(self.value, dict) else {}
        body.update(self.meta)
        if self.warnings:
            body["warnings"] = list(self.warnings)
        return body


def ok[T](value: T, **meta: Any) -> Outcome[T]:
    """The common case: it worked, here is what came of it."""
    return Outcome(value=value, meta=dict(meta))
