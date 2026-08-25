"""Broken Object Level Authorisation — OWASP API1.

The most common API vulnerability there is, and the one this system is most
exposed to: every route takes a uuid, and the question is always whether the
caller is allowed *that* uuid rather than merely allowed the endpoint.

The defence here is structural rather than a check. Row scope is compiled into
the WHERE clause, so a row outside scope is never selected — which means the
service cannot forget to filter, because there is nothing to filter. These tests
assert that property directly against the repositories, at the level where it is
implemented.

They also assert the **404-not-403** rule. Answering 403 for a row that exists
but is out of scope confirms its existence, and existence is exactly what the
scope was meant to withhold. A caller probing uuids must not be able to tell "not
yours" from "not there".
"""

from __future__ import annotations

from typing import Any

import pytest

from cmp.core.errors import NotFound
from cmp.core.permissions import Role
from cmp.db.repositories import consent as consent_repo
from cmp.db.repositories import notices as notice_repo
from cmp.db.repositories import projects as project_repo

pytestmark = pytest.mark.integration


async def _other_rnd_user(conn: Any, seeded: dict[str, Any]) -> dict[str, Any]:
    """A second R&D User who owns nothing in the seeded world."""
    result = await conn.execute(
        """INSERT INTO auth_user (full_name, email, role, status)
           VALUES ('Other Researcher', 'other.rnd@test.local', 'rnd_user', 'active')
           RETURNING id, uuid""",
    )
    row = await result.fetchone()
    return dict(row)


class TestProjectScope:
    """A project is visible to its creator, its DCO, and the DPO. Nobody else."""

    async def test_another_rnd_user_cannot_read_a_project_they_did_not_create(
        self, conn: Any, seeded: dict[str, Any]
    ) -> None:
        stranger = await _other_rnd_user(conn, seeded)

        found = await project_repo.by_uuid(
            conn,
            str(seeded["project"]["project_uuid"]),
            role=Role.RND_USER,
            user_id=stranger["id"],
        )

        # Not "returned but filtered later" — not returned at all.
        assert found is None

    async def test_the_scoped_lookup_raises_not_found_never_forbidden(
        self, conn: Any, seeded: dict[str, Any]
    ) -> None:
        """The 403-vs-404 rule, asserted where it is decided.

        A 403 here would tell somebody walking uuids which ones are real.
        """
        stranger = await _other_rnd_user(conn, seeded)

        with pytest.raises(NotFound):
            await project_repo.require(
                conn,
                str(seeded["project"]["project_uuid"]),
                role=Role.RND_USER,
                user_id=stranger["id"],
            )

    async def test_the_creator_can_read_their_own_project(
        self, conn: Any, seeded: dict[str, Any]
    ) -> None:
        """The control has to permit the legitimate case, or it is just an outage."""
        found = await project_repo.by_uuid(
            conn,
            str(seeded["project"]["project_uuid"]),
            role=Role.RND_USER,
            user_id=seeded["users"]["rnd_user"]["id"],
        )
        assert found is not None

    async def test_the_dpo_sees_every_project(self, conn: Any, seeded: dict[str, Any]) -> None:
        found = await project_repo.by_uuid(
            conn,
            str(seeded["project"]["project_uuid"]),
            role=Role.DPO,
            user_id=seeded["users"]["dpo"]["id"],
        )
        assert found is not None

    async def test_a_dco_sees_projects_they_are_the_dco_of_and_no_others(
        self, conn: Any, seeded: dict[str, Any]
    ) -> None:
        other = await conn.execute(
            """INSERT INTO auth_user (full_name, email, role, status)
               VALUES ('Other DCO', 'other.dco@test.local', 'dco', 'active')
               RETURNING id""",
        )
        other_dco = (await other.fetchone())["id"]

        mine = await project_repo.by_uuid(
            conn,
            str(seeded["project"]["project_uuid"]),
            role=Role.DCO,
            user_id=seeded["users"]["dco"]["id"],
        )
        theirs = await project_repo.by_uuid(
            conn,
            str(seeded["project"]["project_uuid"]),
            role=Role.DCO,
            user_id=other_dco,
        )

        assert mine is not None
        assert theirs is None


class TestNoticeScope:
    """A notice inherits its project's scope. It has no scope of its own."""

    async def test_a_stranger_cannot_read_a_notice_by_uuid(
        self, conn: Any, seeded: dict[str, Any]
    ) -> None:
        stranger = await _other_rnd_user(conn, seeded)

        found = await notice_repo.by_uuid(
            conn,
            str(seeded["notice"]["notice_uuid"]),
            role=Role.RND_USER,
            user_id=stranger["id"],
        )
        assert found is None


class TestConsentScope:
    """A consent artefact is the most sensitive row in the system."""

    async def test_a_stranger_cannot_read_a_consent_artefact(
        self, conn: Any, seeded: dict[str, Any]
    ) -> None:
        stranger = await _other_rnd_user(conn, seeded)

        artefact = await conn.execute(
            """INSERT INTO consent_artefact
                 (auth_user_id, notice_id, notice_language_id, notice_content_hash,
                  link_id, served_at, affirmative_action_at, action_type)
               VALUES (%s, %s, %s, %s, %s, now(), now(), 'button_press')
               RETURNING consent_uuid""",
            (
                seeded["subject"]["id"],
                seeded["notice"]["notice_id"],
                seeded["language"]["notice_language_id"],
                seeded["language"]["content_hash"],
                seeded["link"]["link_id"],
            ),
        )
        consent_uuid = str((await artefact.fetchone())["consent_uuid"])

        found = await consent_repo.artefact_scoped(
            conn, consent_uuid, role=Role.RND_USER, user_id=stranger["id"]
        )
        assert found is None

    async def test_the_dpo_can_read_it(self, conn: Any, seeded: dict[str, Any]) -> None:
        artefact = await conn.execute(
            """INSERT INTO consent_artefact
                 (auth_user_id, notice_id, notice_language_id, notice_content_hash,
                  link_id, served_at, affirmative_action_at, action_type)
               VALUES (%s, %s, %s, %s, %s, now(), now(), 'button_press')
               RETURNING consent_uuid""",
            (
                seeded["subject"]["id"],
                seeded["notice"]["notice_id"],
                seeded["language"]["notice_language_id"],
                seeded["language"]["content_hash"],
                seeded["link"]["link_id"],
            ),
        )
        consent_uuid = str((await artefact.fetchone())["consent_uuid"])

        found = await consent_repo.artefact_scoped(
            conn, consent_uuid, role=Role.DPO, user_id=seeded["users"]["dpo"]["id"]
        )
        assert found is not None


class TestListScopeMatchesDetailScope:
    """A list must not leak what the detail lookup would refuse.

    The classic inconsistency: `GET /projects/{uuid}` is scoped and
    `GET /projects` is not, so the row is invisible one way and listed the
    other. The count alone is a disclosure — it says how many projects exist.
    """

    async def test_a_stranger_lists_no_projects_they_cannot_open(
        self, conn: Any, seeded: dict[str, Any]
    ) -> None:
        from cmp.core.pagination import PageRequest

        stranger = await _other_rnd_user(conn, seeded)

        items, _, total = await project_repo.list_projects(
            conn,
            PageRequest(limit=50, cursor=None, sort_field="created_at", descending=True),
            role=Role.RND_USER,
            user_id=stranger["id"],
        )

        assert items == []
        # The total is scoped too. A count of 1 with an empty page would say
        # "there is a project here you may not see", which is the disclosure.
        assert total == 0
