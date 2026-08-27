"""One project, two collection owners, and the boundary between them.

Reported against a real project: a study collecting at a third party's campus
*and* at an in-house lab showed both sites to the DCO, and let them mint a
consent link for the in-house one. The RCO saw the same. Neither should see the
other's.

The cause was a gap between two questions that look like one. `scope_predicate`
answers "may this caller reach this *project*", and reaching a project because
you run one of its sites is correct. But every site read then applied that
project-level answer, so running one campus meant reaching all of them - and
`create_link` takes a site.

`site_scope_predicate` answers the narrower question, and these tests hold the
two apart. The rule is deliberately stricter than the report asked for: a DCO
does not see another DCO's campus either, which is the same rule applied
consistently rather than a special case for the in-house boundary.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

import pytest

from cmp.core.errors import NotFound
from cmp.core.pagination import PageRequest
from cmp.core.permissions import Role
from cmp.db.repositories import consent as consent_repo
from cmp.db.repositories import projects as project_repo
from cmp.db.sql import fetch_one
from cmp.domain.consent import service as consent_service

pytestmark = pytest.mark.asyncio


async def _owner(conn: Any, role: str, email: str) -> int:
    row = await fetch_one(
        conn,
        """INSERT INTO auth_user (full_name, email, role, status)
           VALUES (%s, %s, %s::user_role, 'active') RETURNING id""",
        (email.split("@")[0], email, role),
    )
    assert row is not None
    return int(row["id"])


async def _site(
    conn: Any, seeded: dict[str, Any], *, kind: str, code: str, label: str, owner: int
) -> dict[str, Any]:
    """A site on the fixture's project, fed by a source somebody owns."""
    processor = seeded["processors"]["external" if kind == "external" else "in_house"]
    source = await fetch_one(
        conn,
        """INSERT INTO data_source (source_code, name, source_role, exchange_mode,
                                    processor_id, owner_user_id)
           VALUES (%s, %s, 'collection', 'manual_upload', %s, %s)
           RETURNING source_id""",
        (code, label, processor["processor_id"], owner),
    )
    assert source is not None
    site = await fetch_one(
        conn,
        """INSERT INTO project_site (project_id, site_label, source_id, processor_id)
           VALUES (%s, %s, %s, %s) RETURNING site_id, site_uuid""",
        (
            seeded["project"]["project_id"],
            label,
            source["source_id"],
            processor["processor_id"],
        ),
    )
    assert site is not None
    return dict(site)


class TestTwoOwnersOnOneProject:
    """The reported shape: SEED -> CIT run by a DCO, SRIB -> SE run by an RCO."""

    async def _both(self, conn: Any, seeded: dict[str, Any]) -> dict[str, Any]:
        dco = await _owner(conn, "dco", "boundary.dco@test.local")
        rco = await _owner(conn, "rco", "boundary.rco@test.local")
        # The project must name the in-house processor too, or the site is not
        # a legitimate one to begin with.
        await conn.execute(
            """INSERT INTO project_processor (project_id, processor_id, added_by, status)
               VALUES (%s, %s, %s, 'approved')
               ON CONFLICT DO NOTHING""",
            (
                seeded["project"]["project_id"],
                seeded["processors"]["in_house"]["processor_id"],
                seeded["users"]["rnd_user"]["id"],
            ),
        )
        return {
            "dco": dco,
            "rco": rco,
            "cit": await _site(
                conn, seeded, kind="external", code="SRC-B-CIT", label="CIT", owner=dco
            ),
            "se": await _site(
                conn, seeded, kind="in_house", code="SRC-B-SE", label="SE", owner=rco
            ),
        }

    async def test_the_dco_sees_only_their_own_site(
        self, conn: Any, seeded: dict[str, Any]
    ) -> None:
        w = await self._both(conn, seeded)
        labels = {
            s["site_label"]
            for s in await project_repo.list_sites(
                conn, seeded["project"]["project_id"], role=Role.DCO, user_id=w["dco"]
            )
        }
        assert labels == {"CIT"}

    async def test_the_rco_sees_only_theirs(self, conn: Any, seeded: dict[str, Any]) -> None:
        w = await self._both(conn, seeded)
        labels = {
            s["site_label"]
            for s in await project_repo.list_sites(
                conn, seeded["project"]["project_id"], role=Role.RCO, user_id=w["rco"]
            )
        }
        assert labels == {"SE"}

    async def test_the_rnd_owner_sees_both(self, conn: Any, seeded: dict[str, Any]) -> None:
        """They designed the study and arranged its partners. Seeing where it
        collects is not a privilege over somebody else's work."""
        await self._both(conn, seeded)
        labels = {
            s["site_label"]
            for s in await project_repo.list_sites(
                conn,
                seeded["project"]["project_id"],
                role=Role.RND_USER,
                user_id=seeded["users"]["rnd_user"]["id"],
            )
        }
        assert {"CIT", "SE"} <= labels

    async def test_the_dpo_sees_both(self, conn: Any, seeded: dict[str, Any]) -> None:
        await self._both(conn, seeded)
        labels = {
            s["site_label"]
            for s in await project_repo.list_sites(
                conn,
                seeded["project"]["project_id"],
                role=Role.DPO,
                user_id=seeded["users"]["dpo"]["id"],
            )
        }
        assert {"CIT", "SE"} <= labels

    async def test_the_notice_still_names_every_recipient(
        self, conn: Any, seeded: dict[str, Any]
    ) -> None:
        """The one read that must stay unfiltered.

        A recipient list showing only the places its reader runs would be a
        notice that lied to the data principal about where her data goes.
        """
        await self._both(conn, seeded)
        labels = {
            s["site_label"]
            for s in await project_repo.list_sites(conn, seeded["project"]["project_id"])
        }
        assert {"CIT", "SE"} <= labels


class TestReachingAnotherOwnersSite:
    """The half that was not merely a display problem."""

    async def _world(self, conn: Any, seeded: dict[str, Any]) -> dict[str, Any]:
        dco = await _owner(conn, "dco", "reach.dco@test.local")
        rco = await _owner(conn, "rco", "reach.rco@test.local")
        await conn.execute(
            """INSERT INTO project_processor (project_id, processor_id, added_by, status)
               VALUES (%s, %s, %s, 'approved') ON CONFLICT DO NOTHING""",
            (
                seeded["project"]["project_id"],
                seeded["processors"]["in_house"]["processor_id"],
                seeded["users"]["rnd_user"]["id"],
            ),
        )
        return {
            "dco": dco,
            "cit": await _site(
                conn, seeded, kind="external", code="SRC-R-CIT", label="CIT", owner=dco
            ),
            "se": await _site(
                conn, seeded, kind="in_house", code="SRC-R-SE", label="SE", owner=rco
            ),
        }

    async def test_the_dco_cannot_fetch_the_in_house_site(
        self, conn: Any, seeded: dict[str, Any]
    ) -> None:
        w = await self._world(conn, seeded)
        assert (
            await project_repo.site_by_uuid(
                conn, str(w["se"]["site_uuid"]), role=Role.DCO, user_id=w["dco"]
            )
            is None
        )
        # Their own is still reachable — the guard has to narrow, not break.
        assert (
            await project_repo.site_by_uuid(
                conn, str(w["cit"]["site_uuid"]), role=Role.DCO, user_id=w["dco"]
            )
            is not None
        )

    async def test_the_dco_cannot_mint_a_link_for_it(
        self, conn: Any, seeded: dict[str, Any]
    ) -> None:
        """The reported behaviour, and the reason this is a security fix rather
        than a tidier list. A consent link is the authority to collect."""
        w = await self._world(conn, seeded)

        with pytest.raises(NotFound):
            await consent_service.create_link(
                conn,
                site_uuid=str(w["se"]["site_uuid"]),
                expires_at=datetime.now(UTC) + timedelta(days=7),
                max_uses=None,
                actor_id=w["dco"],
                role=Role.DCO,
            )


class TestConsentsFollowTheSameBoundary:
    """Keying on the project's *primary* owner was wrong in both directions: the
    primary site's owner saw every consent on the project including ones taken
    at somebody else's campus, and that other owner saw none of their own."""

    async def _consent_at(self, conn: Any, seeded: dict[str, Any], site_id: int) -> None:
        """A consent collected at one specific site."""
        link = await fetch_one(
            conn,
            """INSERT INTO consent_link (notice_id, site_id, token, expires_at, created_by)
               VALUES (%s, %s, %s, now() + interval '7 days', %s)
               RETURNING link_id""",
            (
                seeded["notice"]["notice_id"],
                site_id,
                f"tok-{site_id}-0000000000000000000000",
                seeded["users"]["dpo"]["id"],
            ),
        )
        assert link is not None
        await conn.execute(
            """INSERT INTO consent_artefact
                      (auth_user_id, notice_id, notice_language_id, notice_content_hash,
                       link_id, served_at, affirmative_action_at, action_type)
               VALUES (%s, %s, %s, %s, %s, now(), now(), 'checkbox_click')""",
            (
                seeded["subject"]["id"],
                seeded["notice"]["notice_id"],
                seeded["language"]["notice_language_id"],
                seeded["language"]["content_hash"],
                link["link_id"],
            ),
        )

    async def _page(self) -> PageRequest:
        return PageRequest(limit=50, cursor=None, sort_field="created_at", descending=True)

    async def test_the_owner_of_that_site_sees_it(self, conn: Any, seeded: dict[str, Any]) -> None:
        dco = await _owner(conn, "dco", "cons.mine@test.local")
        site = await _site(conn, seeded, kind="external", code="SRC-C-MINE", label="CIT", owner=dco)
        await self._consent_at(conn, seeded, site["site_id"])

        rows, _, _ = await consent_repo.list_all_consents(
            conn, await self._page(), role=Role.DCO, user_id=dco
        )
        assert len(rows) == 1

    async def test_the_other_owner_does_not(self, conn: Any, seeded: dict[str, Any]) -> None:
        """The reported leak, on the consent register rather than the site list."""
        dco = await _owner(conn, "dco", "cons.theirs@test.local")
        rco = await _owner(conn, "rco", "cons.rco@test.local")
        await conn.execute(
            """INSERT INTO project_processor (project_id, processor_id, added_by, status)
               VALUES (%s, %s, %s, 'approved') ON CONFLICT DO NOTHING""",
            (
                seeded["project"]["project_id"],
                seeded["processors"]["in_house"]["processor_id"],
                seeded["users"]["rnd_user"]["id"],
            ),
        )
        mine = await _site(conn, seeded, kind="external", code="SRC-C-A", label="CIT", owner=dco)
        await _site(conn, seeded, kind="in_house", code="SRC-C-B", label="SE", owner=rco)
        await self._consent_at(conn, seeded, mine["site_id"])

        rows, _, _ = await consent_repo.list_all_consents(
            conn, await self._page(), role=Role.RCO, user_id=rco
        )
        assert rows == [], "a consent taken at the DCO's campus is not the RCO's to read"

    async def test_the_rnd_owner_sees_the_projects_consents(
        self, conn: Any, seeded: dict[str, Any]
    ) -> None:
        dco = await _owner(conn, "dco", "cons.rnd@test.local")
        site = await _site(conn, seeded, kind="external", code="SRC-C-RND", label="CIT", owner=dco)
        await self._consent_at(conn, seeded, site["site_id"])

        rows, _, _ = await consent_repo.list_all_consents(
            conn,
            await self._page(),
            role=Role.RND_USER,
            user_id=seeded["users"]["rnd_user"]["id"],
        )
        assert rows, "the study's own consents are what it exists to produce"
