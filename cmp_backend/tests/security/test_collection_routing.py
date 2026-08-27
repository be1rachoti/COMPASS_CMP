"""Who reaches a project once it is approved, and why.

The routing split is a security property, not a workflow convenience. A DCO
Admin holds every project somebody outside is collecting for — which is a wide
grant, and the thing that keeps it honest is that it is *only* those. If an
in-house project leaked into that scope, a role defined by third-party oversight
would be reading collection it has no part in.

These assert against the repository, where the predicate is compiled into the
WHERE clause, because that is the level at which the property is real. A service
test would prove the service passed the right arguments, not that a row outside
scope is unselectable.
"""

from __future__ import annotations

from typing import Any

import pytest

from cmp.core.permissions import Role
from cmp.db.repositories import projects as project_repo
from cmp.db.repositories import registry as registry_repo
from cmp.db.sql import fetch_one

pytestmark = pytest.mark.asyncio


async def _user(conn: Any, role: str, email: str) -> int:
    row = await fetch_one(
        conn,
        """INSERT INTO auth_user (full_name, email, role, status)
           VALUES (%s, %s, %s::user_role, 'active') RETURNING id""",
        (email.split("@")[0], email, role),
    )
    assert row is not None
    return int(row["id"])


async def _project(conn: Any, name: str, created_by: int, processor_id: int) -> dict[str, Any]:
    project = await fetch_one(
        conn,
        """INSERT INTO project (project_name, description, created_by, project_status)
           VALUES (%s, 'A project', %s, 'approved')
           RETURNING project_id, project_uuid""",
        (name, created_by),
    )
    assert project is not None
    await conn.execute(
        """INSERT INTO project_processor (project_id, processor_id, added_by)
           VALUES (%s, %s, %s)""",
        (project["project_id"], processor_id, created_by),
    )
    return project


class TestTheDcoAdminHoldsThirdPartyCollectionAndOnlyThat:
    async def test_a_third_party_project_is_in_scope(
        self, conn: Any, seeded: dict[str, Any]
    ) -> None:
        admin = await _user(conn, "dco_admin", "route.admin@test.local")
        project = await _project(
            conn,
            "Partner campus study",
            seeded["users"]["rnd_user"]["id"],
            seeded["processors"]["external"]["processor_id"],
        )

        seen = await project_repo.by_uuid(
            conn, str(project["project_uuid"]), role=Role.DCO_ADMIN, user_id=admin
        )
        assert seen is not None

    async def test_an_in_house_project_is_not(self, conn: Any, seeded: dict[str, Any]) -> None:
        """The boundary that makes the wide grant defensible.

        Collection the R&D team does itself has no third party to oversee, so it
        goes back to the R&D owner instead. A DCO Admin reading it would be
        reading work their role has no part in.
        """
        admin = await _user(conn, "dco_admin", "route.admin2@test.local")
        project = await _project(
            conn,
            "In-house study",
            seeded["users"]["rnd_user"]["id"],
            seeded["processors"]["in_house"]["processor_id"],
        )

        seen = await project_repo.by_uuid(
            conn, str(project["project_uuid"]), role=Role.DCO_ADMIN, user_id=admin
        )
        assert seen is None

    async def test_a_project_naming_both_is_in_scope(
        self, conn: Any, seeded: dict[str, Any]
    ) -> None:
        """A study running at a partner campus *and* in-house is ordinary.

        There is third-party collection to oversee, so the DCO Admin holds it.
        The in-house half does not cancel that out - it adds a second route,
        it does not remove the first.
        """
        admin = await _user(conn, "dco_admin", "route.admin3@test.local")
        project = await _project(
            conn,
            "Mixed study",
            seeded["users"]["rnd_user"]["id"],
            seeded["processors"]["in_house"]["processor_id"],
        )
        await conn.execute(
            """INSERT INTO project_processor (project_id, processor_id, added_by)
               VALUES (%s, %s, %s)""",
            (
                project["project_id"],
                seeded["processors"]["external"]["processor_id"],
                seeded["users"]["rnd_user"]["id"],
            ),
        )

        seen = await project_repo.by_uuid(
            conn, str(project["project_uuid"]), role=Role.DCO_ADMIN, user_id=admin
        )
        assert seen is not None

    async def test_the_scope_does_not_depend_on_who_is_asking(
        self, conn: Any, seeded: dict[str, Any]
    ) -> None:
        """Two DCO Admins see the same queue.

        The role is defined by the work rather than by assignment, so there is no
        per-user narrowing to get wrong - and pinning that here stops somebody
        "fixing" it into an assigned set later without noticing the routing queue
        would then have holes in it.
        """
        one = await _user(conn, "dco_admin", "route.a@test.local")
        two = await _user(conn, "dco_admin", "route.b@test.local")
        project = await _project(
            conn,
            "Either admin's study",
            seeded["users"]["rnd_user"]["id"],
            seeded["processors"]["external"]["processor_id"],
        )

        for who in (one, two):
            seen = await project_repo.by_uuid(
                conn, str(project["project_uuid"]), role=Role.DCO_ADMIN, user_id=who
            )
            assert seen is not None


class TestRoutingFollowsTheSource:
    async def test_attaching_a_source_hands_the_project_to_its_owner(
        self, conn: Any, seeded: dict[str, Any]
    ) -> None:
        dco = await _user(conn, "dco", "owner.cit@test.local")
        source = await fetch_one(
            conn,
            """INSERT INTO data_source (source_code, name, source_role, exchange_mode,
                                        processor_id, owner_user_id)
               VALUES ('SRC-CIT-T', 'CIT', 'collection', 'manual_upload', %s, %s)
               RETURNING source_id""",
            (seeded["processors"]["external"]["processor_id"], dco),
        )
        assert source is not None

        project = await _project(
            conn,
            "Routed study",
            seeded["users"]["rnd_user"]["id"],
            seeded["processors"]["external"]["processor_id"],
        )
        site = await fetch_one(
            conn,
            """INSERT INTO project_site (project_id, site_label) VALUES (%s, 'Campus')
               RETURNING site_id""",
            (project["project_id"],),
        )
        assert site is not None

        assert await project_repo.project_dco_id(conn, project["project_id"]) is None
        await project_repo.set_site_source(conn, site["site_id"], source["source_id"])
        assert await project_repo.project_dco_id(conn, project["project_id"]) == dco

    async def test_reassigning_a_shared_source_moves_every_project_using_it(
        self, conn: Any, seeded: dict[str, Any]
    ) -> None:
        """The reason ownership moved off the site in the first place.

        One rig, three studies, one owner. Before this the owner was recorded
        once per study and nothing stopped those three records disagreeing.
        """
        first = await _user(conn, "dco", "shared.first@test.local")
        second = await _user(conn, "dco", "shared.second@test.local")
        source = await fetch_one(
            conn,
            """INSERT INTO data_source (source_code, name, source_role, exchange_mode,
                                        processor_id, owner_user_id)
               VALUES ('SRC-SHARED-T', 'Shared rig', 'collection', 'manual_upload', %s, %s)
               RETURNING source_id""",
            (seeded["processors"]["external"]["processor_id"], first),
        )
        assert source is not None

        projects = []
        for n in range(3):
            project = await _project(
                conn,
                f"Study {n}",
                seeded["users"]["rnd_user"]["id"],
                seeded["processors"]["external"]["processor_id"],
            )
            await conn.execute(
                """INSERT INTO project_site (project_id, site_label, source_id)
                   VALUES (%s, %s, %s)""",
                (project["project_id"], f"Site {n}", source["source_id"]),
            )
            projects.append(project)

        for project in projects:
            assert await project_repo.project_dco_id(conn, project["project_id"]) == first

        await registry_repo.set_source_owner(conn, source["source_id"], second)

        for project in projects:
            assert await project_repo.project_dco_id(conn, project["project_id"]) == second

    async def test_taking_a_source_back_leaves_no_stale_owner(
        self, conn: Any, seeded: dict[str, Any]
    ) -> None:
        """An unowned source must not keep pointing at whoever held it last.

        A name left on a project after the person stopped being accountable is
        worse than an empty field: it is an answer that reads as current.
        """
        dco = await _user(conn, "dco", "leaver@test.local")
        source = await fetch_one(
            conn,
            """INSERT INTO data_source (source_code, name, source_role, exchange_mode,
                                        processor_id, owner_user_id)
               VALUES ('SRC-LEAVER-T', 'Rig', 'collection', 'manual_upload', %s, %s)
               RETURNING source_id""",
            (seeded["processors"]["external"]["processor_id"], dco),
        )
        assert source is not None

        project = await _project(
            conn,
            "Abandoned study",
            seeded["users"]["rnd_user"]["id"],
            seeded["processors"]["external"]["processor_id"],
        )
        await conn.execute(
            """INSERT INTO project_site (project_id, site_label, source_id)
               VALUES (%s, 'Campus', %s)""",
            (project["project_id"], source["source_id"]),
        )
        assert await project_repo.project_dco_id(conn, project["project_id"]) == dco

        await registry_repo.set_source_owner(conn, source["source_id"], None)

        assert await project_repo.project_dco_id(conn, project["project_id"]) is None


class TestAnRcoIsScopedLikeADco:
    async def test_an_rco_reaches_the_project_deploying_their_source(
        self, conn: Any, seeded: dict[str, Any]
    ) -> None:
        rco = await _user(conn, "rco", "rco.owner@test.local")
        source = await fetch_one(
            conn,
            """INSERT INTO data_source (source_code, name, source_role, exchange_mode,
                                        processor_id, owner_user_id)
               VALUES ('SRC-SE-T', 'SE', 'collection', 'manual_upload', %s, %s)
               RETURNING source_id""",
            (seeded["processors"]["in_house"]["processor_id"], rco),
        )
        assert source is not None

        project = await _project(
            conn,
            "In-house routed study",
            seeded["users"]["rnd_user"]["id"],
            seeded["processors"]["in_house"]["processor_id"],
        )
        await conn.execute(
            """INSERT INTO project_site (project_id, site_label, source_id)
               VALUES (%s, 'Lab', %s)""",
            (project["project_id"], source["source_id"]),
        )

        seen = await project_repo.by_uuid(
            conn, str(project["project_uuid"]), role=Role.RCO, user_id=rco
        )
        assert seen is not None

    async def test_an_rco_reaches_nothing_they_do_not_own(
        self, conn: Any, seeded: dict[str, Any]
    ) -> None:
        stranger = await _user(conn, "rco", "rco.stranger@test.local")
        project = await _project(
            conn,
            "Somebody else's study",
            seeded["users"]["rnd_user"]["id"],
            seeded["processors"]["in_house"]["processor_id"],
        )

        seen = await project_repo.by_uuid(
            conn, str(project["project_uuid"]), role=Role.RCO, user_id=stranger
        )
        assert seen is None
