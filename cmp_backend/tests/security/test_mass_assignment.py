"""Mass assignment — OWASP API3 / API6.

The failure: a request model that accepts more than the endpoint meant to offer,
so a caller sets a field nobody intended them to set. The classic is
`{"role": "admin"}` on a profile update.

Two structural defences, both asserted here:

* **Requests forbid unknown fields.** `Schema` sets `extra="forbid"`, so an
  unexpected key is a 422 rather than a silent no-op. Silence is the dangerous
  outcome — the caller cannot tell whether the field was applied.
* **Responses ignore unknown fields.** `Out` sets `extra="ignore"`, which is the
  *opposite* setting and deliberately so: repository rows carry internal columns,
  and `response_model` filtering is what strips them. Forbidding extras there
  would turn that filtering into a 500 and tempt somebody to "fix" it by widening
  the model until the integer id ships to the browser.

The third test class is the one that matters most in this system: **no integer
primary key may appear in any response model.** A sequential id tells the reader
how many rows exist and lets them walk the neighbours.
"""

from __future__ import annotations

import inspect
import pkgutil
from importlib import import_module

import pytest
from pydantic import BaseModel, ValidationError

from cmp.schemas.common import Out, Schema


class TestRequestModelsRejectUnknownFields:
    def test_the_request_base_forbids_extras(self) -> None:
        assert Schema.model_config.get("extra") == "forbid"

    def test_an_unexpected_field_is_refused_not_ignored(self) -> None:
        class ProfileUpdate(Schema):
            full_name: str

        with pytest.raises(ValidationError) as caught:
            ProfileUpdate(full_name="Priya", role="admin")  # type: ignore[call-arg]

        # The error names the field, so the client learns what was refused
        # rather than being told the whole body was wrong.
        assert "role" in str(caught.value)

    def test_whitespace_is_stripped_so_a_padded_value_cannot_slip_a_check(self) -> None:
        class Login(Schema):
            login: str

        assert Login(login="  dpo@cmp.local  ").login == "dpo@cmp.local"


class TestResponseModelsFilterRatherThanFail:
    def test_the_response_base_ignores_extras(self) -> None:
        """The opposite of the request base, and on purpose.

        A repository row carries `project_id` and join scaffolding. Filtering is
        the mechanism that strips them; a 500 here would be pressure to widen
        the model instead.
        """
        assert Out.model_config.get("extra") == "ignore"

    def test_an_internal_column_is_dropped_not_echoed(self) -> None:
        class ProjectOut(Out):
            project_uuid: str
            project_name: str

        row = {
            "project_id": 42,                 # internal surrogate key
            "project_uuid": "b5a5a382-cd5f-4c57-a8f7-abc2cc872382",
            "project_name": "Gait Study",
            "dco_user_id": 17,                # join scaffolding
        }
        dumped = ProjectOut.model_validate(row).model_dump()

        assert dumped == {
            "project_uuid": "b5a5a382-cd5f-4c57-a8f7-abc2cc872382",
            "project_name": "Gait Study",
        }
        assert "project_id" not in dumped
        assert "dco_user_id" not in dumped


def _response_models() -> list[type[BaseModel]]:
    """Every response model declared under `cmp.api.routers`.

    Discovered by walking the package rather than listed, so a router added next
    month is covered without anybody remembering to add it here.
    """
    import cmp.api.routers as routers_pkg

    found: list[type[BaseModel]] = []
    for info in pkgutil.walk_packages(routers_pkg.__path__, f"{routers_pkg.__name__}."):
        module = import_module(info.name)
        for _, obj in inspect.getmembers(module, inspect.isclass):
            if issubclass(obj, Out) and obj is not Out and obj.__module__ == info.name:
                found.append(obj)
    return found


#: Field names that would be an internal integer key on the wire. `version` and
#: counts are integers too, so the test is on the *name*, not the type.
_FORBIDDEN_FIELD_NAMES = {
    "id",
    "project_id",
    "notice_id",
    "purpose_id",
    "consent_id",
    "user_id",
    "auth_user_id",
    "site_id",
    "link_id",
    "export_id",
    "batch_id",
    "collection_id",
    "asset_id",
    "approval_id",
    "processor_id",
    "source_id",
    "log_id",
    "notice_language_id",
    "history_id",
}


class TestNoSurrogateKeyReachesTheWire:
    """Every identifier crossing the boundary is a uuid.

    An integer primary key in a response body is an invitation to enumerate, and
    it becomes part of the contract the moment somebody reads it off the wire —
    at which point the surrogate key can never be renumbered.

    This has bitten twice already: `purpose_id` shipped on a public notice
    payload, and `consent_id` on the consent detail endpoint. Both were caught by
    review; this catches the third.
    """

    def test_at_least_one_response_model_was_discovered(self) -> None:
        """Guards the guard — a walk that finds nothing would pass vacuously."""
        assert len(_response_models()) > 20

    @pytest.mark.parametrize(
        "model", _response_models(), ids=lambda m: f"{m.__module__.split('.')[-1]}.{m.__name__}"
    )
    def test_no_response_model_declares_a_surrogate_key(self, model: type[BaseModel]) -> None:
        offending = sorted(set(model.model_fields) & _FORBIDDEN_FIELD_NAMES)
        assert not offending, (
            f"{model.__module__}.{model.__name__} would serialise {offending}. "
            "Identifiers crossing the boundary are uuids."
        )
