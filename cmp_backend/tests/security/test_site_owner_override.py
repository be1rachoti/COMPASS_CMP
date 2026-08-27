"""Naming somebody for one site, without moving the rig.

The override exists because reassigning the data source was the only way to say
"somebody else runs this campus on this project" - and it said far more than
that. Every project collecting from the same rig moved with it, silently, as a
side effect of a decision about one of them.

So most of what follows is a negative property: naming somebody here changes
this site, this project, and nothing else. That is the part which is invisible
from the screen where the decision is made, and therefore the part worth
pinning down.
"""

from __future__ import annotations

from typing import Any

import pytest

from cmp.core.permissions import Role
from cmp.db.repositories import projects as project_repo
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


async def _project(conn: Any, name: str, seeded: dict[str, Any]) -> dict[str, Any]:
    project = await fetch_one(
        conn,
        """INSERT INTO project (project_name, description, created_by, project_status)
           VALUES (%s, 'A project', %s, 'approved')
           RETURNING project_id, project_uuid""",
        (name, seeded["users"]["rnd_user"]["id"]),
    )
    assert project is not None
    await conn.execute(
        """INSERT INTO project_processor (project_id, processor_id, added_by)
           VALUES (%s, %s, %s)""",
        (
            project["project_id"],
            seeded["processors"]["external"]["processor_id"],
            seeded["users"]["rnd_user"]["id"],
        ),
    )
    return project


async def _rig(conn: Any, seeded: dict[str, Any], code: str, owner: int) -> int:
    row = await fetch_one(
        conn,
        """INSERT INTO data_source (source_code, name, source_role, exchange_mode,
                                    processor_id, owner_user_id)
           VALUES (%s, 'Shared rig', 'collection', 'manual_upload', %s, %s)
           RETURNING source_id""",
        (code, seeded["processors"]["external"]["processor_id"], owner),
    )
    assert row is not None
    return int(row["source_id"])


async def _site(conn: Any, project_id: int, label: str, source_id: int) -> int:
    row = await fetch_one(
        conn,
        """INSERT INTO project_site (project_id, site_label, source_id)
           VALUES (%s, %s, %s) RETURNING site_id""",
        (project_id, label, source_id),
    )
    assert row is not None
    return int(row["site_id"])


class TestTheOverrideStaysWhereItWasPut:
    async def test_it_moves_this_project_and_leaves_the_others(
        self, conn: Any, seeded: dict[str, Any]
    ) -> None:
        usual = await _user(conn, "dco", "usual.owner@test.local")
        stand_in = await _user(conn, "dco", "stand.in@test.local")
        rig = await _rig(conn, seeded, "SRC-SHARED-OV", usual)

        projects, sites = [], []
        for n in range(3):
            project = await _project(conn, f"Override study {n}", seeded)
            projects.append(project)
            sites.append(await _site(conn, project["project_id"], f"Campus {n}", rig))

        for project in projects:
            assert await project_repo.project_dco_id(conn, project["project_id"]) == usual

        await project_repo.set_site_owner_override(
            conn, sites[0], stand_in, actor_id=seeded["users"]["dpo"]["id"]
        )

        assert await project_repo.project_dco_id(conn, projects[0]["project_id"]) == stand_in
        # The two the decision was not about.
        assert await project_repo.project_dco_id(conn, projects[1]["project_id"]) == usual
        assert await project_repo.project_dco_id(conn, projects[2]["project_id"]) == usual

    async def test_the_source_keeps_its_owner(self, conn: Any, seeded: dict[str, Any]) -> None:
        """The rig is not tagged to the stand-in.

        That is the whole distinction between this and reassigning the source,
        and it is invisible from the project screen - so it is asserted here
        rather than assumed.
        """
        usual = await _user(conn, "dco", "keeps.owner@test.local")
        stand_in = await _user(conn, "dco", "keeps.standin@test.local")
        rig = await _rig(conn, seeded, "SRC-KEEPS-OV", usual)
        project = await _project(conn, "Keeps study", seeded)
        site = await _site(conn, project["project_id"], "Campus", rig)

        await project_repo.set_site_owner_override(
            conn, site, stand_in, actor_id=seeded["users"]["dpo"]["id"]
        )

        row = await fetch_one(
            conn, "SELECT owner_user_id FROM data_source WHERE source_id = %s", (rig,)
        )
        assert row is not None
        assert row["owner_user_id"] == usual

    async def test_clearing_it_hands_the_site_back_to_the_source(
        self, conn: Any, seeded: dict[str, Any]
    ) -> None:
        """How an override normally ends: it was cover, and the cover finished."""
        usual = await _user(conn, "dco", "back.owner@test.local")
        stand_in = await _user(conn, "dco", "back.standin@test.local")
        rig = await _rig(conn, seeded, "SRC-BACK-OV", usual)
        project = await _project(conn, "Back study", seeded)
        site = await _site(conn, project["project_id"], "Campus", rig)

        await project_repo.set_site_owner_override(
            conn, site, stand_in, actor_id=seeded["users"]["dpo"]["id"]
        )
        assert await project_repo.project_dco_id(conn, project["project_id"]) == stand_in

        await project_repo.set_site_owner_override(
            conn, site, None, actor_id=seeded["users"]["dpo"]["id"]
        )
        assert await project_repo.project_dco_id(conn, project["project_id"]) == usual

    async def test_reassigning_the_rig_does_not_disturb_an_overridden_site(
        self, conn: Any, seeded: dict[str, Any]
    ) -> None:
        """The exception outranks the derivation, in both directions.

        Somebody was named for this site *instead of* the source's owner. Who
        that owner happens to be afterwards is not this site's business.
        """
        usual = await _user(conn, "dco", "rig.first@test.local")
        successor = await _user(conn, "dco", "rig.second@test.local")
        stand_in = await _user(conn, "dco", "rig.standin@test.local")
        rig = await _rig(conn, seeded, "SRC-RIGMOVE-OV", usual)
        project = await _project(conn, "Rig move study", seeded)
        site = await _site(conn, project["project_id"], "Campus", rig)

        await project_repo.set_site_owner_override(
            conn, site, stand_in, actor_id=seeded["users"]["dpo"]["id"]
        )

        from cmp.db.repositories import registry as registry_repo

        await registry_repo.set_source_owner(conn, rig, successor)

        assert await project_repo.project_dco_id(conn, project["project_id"]) == stand_in


class TestTheNamedPersonCanActuallyWork:
    async def test_they_reach_the_project_though_the_rig_is_not_theirs(
        self, conn: Any, seeded: dict[str, Any]
    ) -> None:
        """"The new DCO user will work with same site although it is not tagged
        to him." Row scope has to agree, or somebody is named on a screen they
        cannot open.
        """
        usual = await _user(conn, "dco", "reach.owner@test.local")
        stand_in = await _user(conn, "dco", "reach.standin@test.local")
        rig = await _rig(conn, seeded, "SRC-REACH-OV", usual)
        project = await _project(conn, "Reach study", seeded)
        site = await _site(conn, project["project_id"], "Campus", rig)

        before = await project_repo.by_uuid(
            conn, str(project["project_uuid"]), role=Role.DCO, user_id=stand_in
        )
        assert before is None, "they own nothing on it yet"

        await project_repo.set_site_owner_override(
            conn, site, stand_in, actor_id=seeded["users"]["dpo"]["id"]
        )

        readable = await project_repo.by_uuid(
            conn, str(project["project_uuid"]), role=Role.DCO, user_id=stand_in
        )
        writable = await project_repo.by_uuid(
            conn, str(project["project_uuid"]), role=Role.DCO, user_id=stand_in, write=True
        )
        assert readable is not None
        assert writable is not None, "the site they were named for is the primary one"

    async def test_several_sites_can_name_several_people(
        self, conn: Any, seeded: dict[str, Any]
    ) -> None:
        """Multiple sites, multiple owners - and the project follows its primary.

        The others are not merely tolerated: each holds their own site and can
        read the project, which is what makes a study split across campuses
        workable rather than a queue behind one person.
        """
        usual = await _user(conn, "dco", "many.owner@test.local")
        first = await _user(conn, "dco", "many.first@test.local")
        second = await _user(conn, "dco", "many.second@test.local")
        rig = await _rig(conn, seeded, "SRC-MANY-OV", usual)
        project = await _project(conn, "Three campuses", seeded)

        site_a = await _site(conn, project["project_id"], "Campus A", rig)
        site_b = await _site(conn, project["project_id"], "Campus B", rig)

        actor = seeded["users"]["dpo"]["id"]
        await project_repo.set_site_owner_override(conn, site_a, first, actor_id=actor)
        await project_repo.set_site_owner_override(conn, site_b, second, actor_id=actor)

        # The earliest active site decides who the project belongs to.
        assert await project_repo.project_dco_id(conn, project["project_id"]) == first
        # And the other named owner still reaches it, through the site they hold.
        assert (
            await project_repo.by_uuid(
                conn, str(project["project_uuid"]), role=Role.DCO, user_id=second
            )
            is not None
        )

    async def test_the_site_list_says_who_runs_each_one_and_why(
        self, conn: Any, seeded: dict[str, Any]
    ) -> None:
        """A named owner that looked identical to a derived one would be a
        change nobody could see they had made."""
        usual = await _user(conn, "dco", "list.owner@test.local")
        stand_in = await _user(conn, "dco", "list.standin@test.local")
        rig = await _rig(conn, seeded, "SRC-LIST-OV", usual)
        project = await _project(conn, "Listed study", seeded)
        site = await _site(conn, project["project_id"], "Campus", rig)

        await project_repo.set_site_owner_override(
            conn, site, stand_in, actor_id=seeded["users"]["dpo"]["id"]
        )

        rows = await project_repo.list_sites(conn, project["project_id"])
        row = next(r for r in rows if r["site_label"] == "Campus")
        assert row["owner_overridden"] is True
        assert row["dco_name"] == "list.standin"
        # What the exception is an exception *to*, so the screen can say so.
        assert row["source_owner_name"] == "list.owner"
        assert row["override_by_name"] is not None


class TestTheExceptionIsAccountable:
    async def test_it_records_who_made_it_and_when(
        self, conn: Any, seeded: dict[str, Any]
    ) -> None:
        usual = await _user(conn, "dco", "attr.owner@test.local")
        stand_in = await _user(conn, "dco", "attr.standin@test.local")
        rig = await _rig(conn, seeded, "SRC-ATTR-OV", usual)
        project = await _project(conn, "Attributed study", seeded)
        site = await _site(conn, project["project_id"], "Campus", rig)

        actor = seeded["users"]["dpo"]["id"]
        await project_repo.set_site_owner_override(conn, site, stand_in, actor_id=actor)

        row = await fetch_one(
            conn,
            "SELECT dco_override_by, dco_override_at FROM project_site WHERE site_id = %s",
            (site,),
        )
        assert row is not None
        assert row["dco_override_by"] == actor
        assert row["dco_override_at"] is not None

    async def test_the_database_refuses_an_unattributed_one(
        self, conn: Any, seeded: dict[str, Any]
    ) -> None:
        """Enforced by CHECK rather than by the repository alone.

        A second write path that forgot the attribution would otherwise produce
        an exception nobody can be asked about, which is the state the audit
        trail exists to prevent.
        """
        usual = await _user(conn, "dco", "check.owner@test.local")
        stand_in = await _user(conn, "dco", "check.standin@test.local")
        rig = await _rig(conn, seeded, "SRC-CHECK-OV", usual)
        project = await _project(conn, "Checked study", seeded)
        site = await _site(conn, project["project_id"], "Campus", rig)

        with pytest.raises(Exception, match="site_override_is_attributed"):
            await conn.execute(
                "UPDATE project_site SET dco_override_user_id = %s WHERE site_id = %s",
                (stand_in, site),
            )
