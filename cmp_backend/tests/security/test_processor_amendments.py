"""Adding a collector to a project that is already approved.

The rule the whole flow exists to keep is one sentence: an approved project must
never collect through an organisation the DPO has not seen. Before this there
were two ways to break it and one way to be stuck - you could forbid the change
entirely (and a study expanding to a second campus had nowhere to go), send the
whole project back for review (suspending collection that was never in
question), or let it through unreviewed.

So the amendment is scoped to the one thing that changed, and *pending means
nothing works yet*. Most of what follows tests that second half, because it is
the half a reasonable implementation gets wrong: putting the row on the list and
forgetting that half the system reads the list.
"""

from __future__ import annotations

from typing import Any

import pytest

from cmp.core.errors import Conflict, ValidationFailed
from cmp.core.permissions import Role
from cmp.db.repositories import projects as project_repo
from cmp.db.sql import fetch_one
from cmp.domain.projects import service as project_service

pytestmark = pytest.mark.asyncio


async def _approved_project(conn: Any, seeded: dict[str, Any], name: str) -> dict[str, Any]:
    project = await fetch_one(
        conn,
        """INSERT INTO project (project_name, description, created_by, project_status)
           VALUES (%s, 'A project', %s, 'approved')
           RETURNING project_id, project_uuid""",
        (name, seeded["users"]["rnd_user"]["id"]),
    )
    assert project is not None
    await conn.execute(
        """INSERT INTO project_processor (project_id, processor_id, added_by, status)
           VALUES (%s, %s, %s, 'approved')""",
        (
            project["project_id"],
            seeded["processors"]["external"]["processor_id"],
            seeded["users"]["rnd_user"]["id"],
        ),
    )
    return project


async def _source_under(conn: Any, processor_id: int, code: str) -> dict[str, Any]:
    row = await fetch_one(
        conn,
        """INSERT INTO data_source (source_code, name, source_role, exchange_mode,
                                    processor_id)
           VALUES (%s, %s, 'collection', 'manual_upload', %s)
           RETURNING source_id, source_uuid""",
        (code, f"Rig {code}", processor_id),
    )
    assert row is not None
    return row


class TestWhereTheRequestGoes:
    async def test_in_draft_it_is_simply_added(self, conn: Any, seeded: dict[str, Any]) -> None:
        """The DPO reviews the whole project at approval, and everything on it.

        Asking separately here would be the same question twice, and a draft
        that needed sign-off to be edited would not be a draft.
        """
        project = await fetch_one(
            conn,
            """INSERT INTO project (project_name, description, created_by, project_status)
               VALUES ('Draft study', 'd', %s, 'in_draft')
               RETURNING project_id, project_uuid""",
            (seeded["users"]["rnd_user"]["id"],),
        )
        assert project is not None

        result = await project_service.request_processor(
            conn,
            project_uuid=str(project["project_uuid"]),
            processor_uuid=str(seeded["processors"]["external"]["processor_uuid"]),
            actor_id=seeded["users"]["rnd_user"]["id"],
            role=Role.RND_USER,
        )
        assert result["status"] == "approved"

    async def test_once_approved_it_waits_for_the_dpo(
        self, conn: Any, seeded: dict[str, Any]
    ) -> None:
        project = await _approved_project(conn, seeded, "Expanding study")

        result = await project_service.request_processor(
            conn,
            project_uuid=str(project["project_uuid"]),
            processor_uuid=str(seeded["processors"]["in_house"]["processor_uuid"]),
            actor_id=seeded["users"]["rnd_user"]["id"],
            role=Role.RND_USER,
        )
        assert result["status"] == "pending"

    async def test_it_also_waits_while_the_dpo_is_mid_review(
        self, conn: Any, seeded: dict[str, Any]
    ) -> None:
        """Slipping a collector in underneath a review in progress would change
        what the DPO is in the middle of approving."""
        project = await fetch_one(
            conn,
            """INSERT INTO project (project_name, description, created_by, project_status)
               VALUES ('Under review', 'd', %s, 'pending_approval')
               RETURNING project_id, project_uuid""",
            (seeded["users"]["rnd_user"]["id"],),
        )
        assert project is not None

        result = await project_service.request_processor(
            conn,
            project_uuid=str(project["project_uuid"]),
            processor_uuid=str(seeded["processors"]["external"]["processor_uuid"]),
            actor_id=seeded["users"]["rnd_user"]["id"],
            role=Role.RND_USER,
        )
        assert result["status"] == "pending"

    async def test_the_project_itself_does_not_move(
        self, conn: Any, seeded: dict[str, Any]
    ) -> None:
        """Collection is live at the existing sites and consent is being taken.

        Sending the whole project back to review to add somewhere else would
        suspend the parts nobody questioned, which is exactly the outcome this
        design exists to avoid.
        """
        project = await _approved_project(conn, seeded, "Still collecting")

        await project_service.request_processor(
            conn,
            project_uuid=str(project["project_uuid"]),
            processor_uuid=str(seeded["processors"]["in_house"]["processor_uuid"]),
            actor_id=seeded["users"]["rnd_user"]["id"],
            role=Role.RND_USER,
        )

        row = await fetch_one(
            conn,
            "SELECT project_status FROM project WHERE project_id = %s",
            (project["project_id"],),
        )
        assert row is not None
        assert row["project_status"] == "approved"


class TestPendingMeansNothingWorksYet:
    """The half a reasonable implementation gets wrong: the row goes on the
    list, and half the system reads the list."""

    async def test_its_sources_cannot_be_deployed(self, conn: Any, seeded: dict[str, Any]) -> None:
        project = await _approved_project(conn, seeded, "Not yet study")
        await project_service.request_processor(
            conn,
            project_uuid=str(project["project_uuid"]),
            processor_uuid=str(seeded["processors"]["in_house"]["processor_uuid"]),
            actor_id=seeded["users"]["rnd_user"]["id"],
            role=Role.RND_USER,
        )
        source = await _source_under(
            conn, seeded["processors"]["in_house"]["processor_id"], "SRC-PENDING-1"
        )

        with pytest.raises(ValidationFailed, match="has not had approved"):
            await project_service.add_site(
                conn,
                project_uuid=str(project["project_uuid"]),
                actor_id=seeded["users"]["rnd_user"]["id"],
                role=Role.RND_USER,
                source_uuid=str(source["source_uuid"]),
            )

    async def test_the_routing_does_not_see_it(self, conn: Any, seeded: dict[str, Any]) -> None:
        """A pending in-house processor must not make an external project look
        like one that comes back to its author."""
        project = await _approved_project(conn, seeded, "Routing study")
        before = await project_repo.collection_route(conn, project["project_id"])
        assert before == {"to_dco_admin": True, "to_rnd_owner": False}

        await project_service.request_processor(
            conn,
            project_uuid=str(project["project_uuid"]),
            processor_uuid=str(seeded["processors"]["in_house"]["processor_uuid"]),
            actor_id=seeded["users"]["rnd_user"]["id"],
            role=Role.RND_USER,
        )

        after = await project_repo.collection_route(conn, project["project_id"])
        assert after == before, "a request nobody has agreed to must not route anything"

    async def test_it_is_absent_from_the_approved_set(
        self, conn: Any, seeded: dict[str, Any]
    ) -> None:
        project = await _approved_project(conn, seeded, "Set study")
        await project_service.request_processor(
            conn,
            project_uuid=str(project["project_uuid"]),
            processor_uuid=str(seeded["processors"]["in_house"]["processor_uuid"]),
            actor_id=seeded["users"]["rnd_user"]["id"],
            role=Role.RND_USER,
        )

        approved = await project_repo.approved_processor_uuids(conn, project["project_id"])
        assert str(seeded["processors"]["external"]["processor_uuid"]) in approved
        assert str(seeded["processors"]["in_house"]["processor_uuid"]) not in approved

        # But it *is* on the list, because the screens have to say it is waiting.
        listed = {
            str(r["processor_uuid"])
            for r in await project_repo.processors_for(conn, project["project_id"])
        }
        assert str(seeded["processors"]["in_house"]["processor_uuid"]) in listed


class TestTheDecision:
    async def _pending(self, conn: Any, seeded: dict[str, Any], name: str) -> dict[str, Any]:
        project = await _approved_project(conn, seeded, name)
        await project_service.request_processor(
            conn,
            project_uuid=str(project["project_uuid"]),
            processor_uuid=str(seeded["processors"]["in_house"]["processor_uuid"]),
            actor_id=seeded["users"]["rnd_user"]["id"],
            role=Role.RND_USER,
        )
        return project

    async def test_approving_makes_it_real(self, conn: Any, seeded: dict[str, Any]) -> None:
        project = await self._pending(conn, seeded, "Agreed study")

        result = await project_service.decide_processor(
            conn,
            project_uuid=str(project["project_uuid"]),
            processor_uuid=str(seeded["processors"]["in_house"]["processor_uuid"]),
            approved=True,
            reason=None,
            actor_id=seeded["users"]["dpo"]["id"],
            role=Role.DPO,
        )
        assert result["status"] == "approved"

        approved = await project_repo.approved_processor_uuids(conn, project["project_id"])
        assert str(seeded["processors"]["in_house"]["processor_uuid"]) in approved

        # And now its sources can be deployed, which is the whole point.
        source = await _source_under(
            conn, seeded["processors"]["in_house"]["processor_id"], "SRC-AGREED-1"
        )
        site = await project_service.add_site(
            conn,
            project_uuid=str(project["project_uuid"]),
            actor_id=seeded["users"]["rnd_user"]["id"],
            role=Role.RND_USER,
            source_uuid=str(source["source_uuid"]),
        )
        assert site["site_uuid"]

    async def test_approving_says_where_the_work_goes_next(
        self, conn: Any, seeded: dict[str, Any]
    ) -> None:
        """An in-house one comes back to the R&D owner; a third party's goes to
        the DCO Admin. Somebody has to be told, and this is the moment."""
        project = await self._pending(conn, seeded, "Routed study")
        result = await project_service.decide_processor(
            conn,
            project_uuid=str(project["project_uuid"]),
            processor_uuid=str(seeded["processors"]["in_house"]["processor_uuid"]),
            approved=True,
            reason=None,
            actor_id=seeded["users"]["dpo"]["id"],
            role=Role.DPO,
        )
        assert "R&D owner" in result["message"]

    async def test_a_refusal_needs_a_reason(self, conn: Any, seeded: dict[str, Any]) -> None:
        project = await self._pending(conn, seeded, "Refused study")

        with pytest.raises(ValidationFailed, match="Say why"):
            await project_service.decide_processor(
                conn,
                project_uuid=str(project["project_uuid"]),
                processor_uuid=str(seeded["processors"]["in_house"]["processor_uuid"]),
                approved=False,
                reason="   ",
                actor_id=seeded["users"]["dpo"]["id"],
                role=Role.DPO,
            )

    async def test_a_refusal_is_kept_with_its_reason(
        self, conn: Any, seeded: dict[str, Any]
    ) -> None:
        """Not deleted. "We asked and were told no, because X" is a fact
        somebody will need, and a vanished row takes the reason with it."""
        project = await self._pending(conn, seeded, "Kept refusal")

        await project_service.decide_processor(
            conn,
            project_uuid=str(project["project_uuid"]),
            processor_uuid=str(seeded["processors"]["in_house"]["processor_uuid"]),
            approved=False,
            reason="No contract in place for internal capture yet.",
            actor_id=seeded["users"]["dpo"]["id"],
            role=Role.DPO,
        )

        rows = await project_repo.processors_for(conn, project["project_id"])
        refused = next(
            r
            for r in rows
            if str(r["processor_uuid"]) == str(seeded["processors"]["in_house"]["processor_uuid"])
        )
        assert refused["status"] == "rejected"
        assert "No contract" in refused["decision_reason"]
        assert refused["decided_by_name"]

    async def test_asking_again_after_a_refusal_is_allowed(
        self, conn: Any, seeded: dict[str, Any]
    ) -> None:
        """A DPO who said no in March should not have to be argued with through
        a workaround in September."""
        project = await self._pending(conn, seeded, "Second ask")
        await project_service.decide_processor(
            conn,
            project_uuid=str(project["project_uuid"]),
            processor_uuid=str(seeded["processors"]["in_house"]["processor_uuid"]),
            approved=False,
            reason="Not yet.",
            actor_id=seeded["users"]["dpo"]["id"],
            role=Role.DPO,
        )

        again = await project_service.request_processor(
            conn,
            project_uuid=str(project["project_uuid"]),
            processor_uuid=str(seeded["processors"]["in_house"]["processor_uuid"]),
            actor_id=seeded["users"]["rnd_user"]["id"],
            role=Role.RND_USER,
        )
        assert again["status"] == "pending"

    async def test_asking_for_one_already_agreed_is_refused(
        self, conn: Any, seeded: dict[str, Any]
    ) -> None:
        """Re-requesting an approved processor would quietly withdraw it back to
        pending, and stop everything already collecting under it."""
        project = await _approved_project(conn, seeded, "Already agreed")

        with pytest.raises(Conflict, match="already on this project"):
            await project_service.request_processor(
                conn,
                project_uuid=str(project["project_uuid"]),
                processor_uuid=str(seeded["processors"]["external"]["processor_uuid"]),
                actor_id=seeded["users"]["rnd_user"]["id"],
                role=Role.RND_USER,
            )

    async def test_deciding_something_nobody_asked_for_is_refused(
        self, conn: Any, seeded: dict[str, Any]
    ) -> None:
        project = await _approved_project(conn, seeded, "Nothing pending")

        with pytest.raises(Conflict, match="no pending request"):
            await project_service.decide_processor(
                conn,
                project_uuid=str(project["project_uuid"]),
                processor_uuid=str(seeded["processors"]["in_house"]["processor_uuid"]),
                approved=True,
                reason=None,
                actor_id=seeded["users"]["dpo"]["id"],
                role=Role.DPO,
            )


class TestTheDpoQueue:
    async def test_a_request_appears_on_it(self, conn: Any, seeded: dict[str, Any]) -> None:
        """Its own queue, because a live project waiting to expand looks like
        nothing is wrong - which is how it gets left sitting."""
        project = await _approved_project(conn, seeded, "Queued study")
        await project_service.request_processor(
            conn,
            project_uuid=str(project["project_uuid"]),
            processor_uuid=str(seeded["processors"]["in_house"]["processor_uuid"]),
            actor_id=seeded["users"]["rnd_user"]["id"],
            role=Role.RND_USER,
        )

        queue = await project_repo.pending_processor_requests(conn)
        mine = [q for q in queue if str(q["project_uuid"]) == str(project["project_uuid"])]
        assert len(mine) == 1
        assert mine[0]["requested_by_name"]

    async def test_it_leaves_the_queue_once_decided(
        self, conn: Any, seeded: dict[str, Any]
    ) -> None:
        project = await _approved_project(conn, seeded, "Cleared study")
        await project_service.request_processor(
            conn,
            project_uuid=str(project["project_uuid"]),
            processor_uuid=str(seeded["processors"]["in_house"]["processor_uuid"]),
            actor_id=seeded["users"]["rnd_user"]["id"],
            role=Role.RND_USER,
        )
        await project_service.decide_processor(
            conn,
            project_uuid=str(project["project_uuid"]),
            processor_uuid=str(seeded["processors"]["in_house"]["processor_uuid"]),
            approved=True,
            reason=None,
            actor_id=seeded["users"]["dpo"]["id"],
            role=Role.DPO,
        )

        queue = await project_repo.pending_processor_requests(conn)
        assert not [q for q in queue if str(q["project_uuid"]) == str(project["project_uuid"])]


class TestCreatingAProjectNamesItsCollectors:
    """Creation goes through `repo.set_processors`, and nothing covered it.

    A refactor removed that function outright and every test here still passed;
    the failure only surfaced as a 500 in the browser. The gap was that the
    amendment tests all start from a project built with raw SQL, so none of them
    exercised the path a user actually takes.
    """

    async def test_a_new_project_carries_the_processors_it_named(
        self, conn: Any, seeded: dict[str, Any]
    ) -> None:
        project = await project_service.create(
            conn,
            actor_id=seeded["users"]["rnd_user"]["id"],
            project_name="Created with collectors",
            description="Checks the creation path itself.",
            processor_uuids=[str(seeded["processors"]["external"]["processor_uuid"])],
        )

        approved = await project_repo.approved_processor_uuids(conn, project["project_id"])
        assert approved == {str(seeded["processors"]["external"]["processor_uuid"])}
        # Approved outright: in draft the DPO reviews the whole project and
        # everything on it, so there is nothing separate to agree to.
        assert [p["status"] for p in project["processors"]] == ["approved"]

    async def test_replacing_the_set_on_a_draft_drops_what_was_removed(
        self, conn: Any, seeded: dict[str, Any]
    ) -> None:
        project = await project_service.create(
            conn,
            actor_id=seeded["users"]["rnd_user"]["id"],
            project_name="Changed its mind",
            description="Checks the replace path.",
            processor_uuids=[
                str(seeded["processors"]["external"]["processor_uuid"]),
                str(seeded["processors"]["in_house"]["processor_uuid"]),
            ],
        )

        await project_service.set_processors(
            conn,
            project_uuid=str(project["project_uuid"]),
            processor_uuids=[str(seeded["processors"]["in_house"]["processor_uuid"])],
            actor_id=seeded["users"]["rnd_user"]["id"],
            role=Role.RND_USER,
        )

        approved = await project_repo.approved_processor_uuids(conn, project["project_id"])
        assert approved == {str(seeded["processors"]["in_house"]["processor_uuid"])}
