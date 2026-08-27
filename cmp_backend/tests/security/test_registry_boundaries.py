"""Who may register what, and under whose processor.

A collection owner registers the rigs they will run, which is a widening: they
could not before. What keeps it narrow is the processor they may register
under - a DCO is accountable for what a third party collects and an RCO for what
the R&D team collects itself, so each registering under the other's processor
would be creating a source they could never be given.

The matrix cannot express that, because the constraint is about the row being
written rather than the role writing it. So it lives in the service, and so do
these tests.
"""

from __future__ import annotations

from typing import Any

import pytest

from cmp.core.errors import ValidationFailed
from cmp.core.permissions import Role
from cmp.db.sql import fetch_one

pytestmark = pytest.mark.asyncio


def _refuse(role: Role, processor: dict[str, Any]) -> None:
    from cmp.api.routers.v1.registry import _refuse_foreign_processor

    _refuse_foreign_processor(role, processor)


class TestACollectionOwnerRegistersUnderTheirOwnProcessor:
    async def test_a_dco_may_use_a_third_party_processor(
        self, conn: Any, seeded: dict[str, Any]
    ) -> None:
        _refuse(Role.DCO, {"is_in_house": False, "legal_name": "SEED"})

    async def test_a_dco_may_not_use_an_in_house_one(
        self, conn: Any, seeded: dict[str, Any]
    ) -> None:
        with pytest.raises(ValidationFailed, match="third-party processor"):
            _refuse(Role.DCO, {"is_in_house": True, "legal_name": "SRIB"})

    async def test_an_rco_may_use_an_in_house_processor(
        self, conn: Any, seeded: dict[str, Any]
    ) -> None:
        _refuse(Role.RCO, {"is_in_house": True, "legal_name": "SRIB"})

    async def test_an_rco_may_not_use_a_third_party_one(
        self, conn: Any, seeded: dict[str, Any]
    ) -> None:
        with pytest.raises(ValidationFailed, match="in-house processor"):
            _refuse(Role.RCO, {"is_in_house": False, "legal_name": "SEED"})

    @pytest.mark.parametrize("role", [Role.DPO, Role.ADMIN, Role.DCO_ADMIN, Role.RND_USER])
    async def test_everybody_else_is_unconstrained(
        self, conn: Any, seeded: dict[str, Any], role: Role
    ) -> None:
        """They register on somebody's behalf rather than for themselves.

        A DCO Admin sets up the sources it is about to route, and an R&D User
        the ones their own team will collect from - neither is claiming
        accountability by doing so, which is what the constraint is about.
        """
        _refuse(role, {"is_in_house": False, "legal_name": "SEED"})
        _refuse(role, {"is_in_house": True, "legal_name": "SRIB"})


class TestASiteIsTheDeploymentOfOneSource:
    """`add_site` takes a data source and nothing else that could disagree with
    it. The label, the processor and the owner all come from the source, so
    there is no second answer to any of them."""

    async def test_the_label_and_processor_come_from_the_source(
        self, conn: Any, seeded: dict[str, Any]
    ) -> None:
        from cmp.domain.projects import service as project_service

        source = await fetch_one(
            conn,
            """INSERT INTO data_source (source_code, name, source_role, exchange_mode,
                                        processor_id)
               VALUES ('SRC-DEPLOY-1', 'Coimbatore rig', 'collection', 'manual_upload', %s)
               RETURNING source_uuid""",
            (seeded["processors"]["external"]["processor_id"],),
        )
        assert source is not None

        site = await project_service.add_site(
            conn,
            project_uuid=str(seeded["project"]["project_uuid"]),
            actor_id=seeded["users"]["rnd_user"]["id"],
            role=Role.DPO,
            source_uuid=str(source["source_uuid"]),
            location="Coimbatore",
        )

        assert site["site_label"] == "Coimbatore rig"
        row = await fetch_one(
            conn,
            "SELECT processor_id, source_id FROM project_site WHERE site_uuid = %s",
            (site["site_uuid"],),
        )
        assert row is not None
        assert row["processor_id"] == seeded["processors"]["external"]["processor_id"]

    async def test_a_source_outside_the_projects_processors_is_refused(
        self, conn: Any, seeded: dict[str, Any]
    ) -> None:
        """The project would be collecting through an organisation the DPO never
        reviewed - which is the whole reason the dropdown is filtered."""
        from cmp.domain.projects import service as project_service

        # Under the in-house processor; the fixture's project names the external.
        source = await fetch_one(
            conn,
            """INSERT INTO data_source (source_code, name, source_role, exchange_mode,
                                        processor_id)
               VALUES ('SRC-DEPLOY-2', 'Wrong rig', 'collection', 'manual_upload', %s)
               RETURNING source_uuid""",
            (seeded["processors"]["in_house"]["processor_id"],),
        )
        assert source is not None

        with pytest.raises(ValidationFailed, match="has not had approved"):
            await project_service.add_site(
                conn,
                project_uuid=str(seeded["project"]["project_uuid"]),
                actor_id=seeded["users"]["rnd_user"]["id"],
                role=Role.DPO,
                source_uuid=str(source["source_uuid"]),
            )

    async def test_the_same_source_cannot_be_deployed_twice(
        self, conn: Any, seeded: dict[str, Any]
    ) -> None:
        """Not a second place - the same place entered twice, which would give
        the notice's recipient list a duplicate."""
        from cmp.core.errors import Conflict
        from cmp.domain.projects import service as project_service

        source = await fetch_one(
            conn,
            """INSERT INTO data_source (source_code, name, source_role, exchange_mode,
                                        processor_id)
               VALUES ('SRC-DEPLOY-3', 'Only once', 'collection', 'manual_upload', %s)
               RETURNING source_uuid""",
            (seeded["processors"]["external"]["processor_id"],),
        )
        assert source is not None

        for attempt in range(2):
            call = project_service.add_site(
                conn,
                project_uuid=str(seeded["project"]["project_uuid"]),
                actor_id=seeded["users"]["rnd_user"]["id"],
                role=Role.DPO,
                source_uuid=str(source["source_uuid"]),
            )
            if attempt == 0:
                await call
            else:
                with pytest.raises(Conflict, match="already a collection site"):
                    await call
