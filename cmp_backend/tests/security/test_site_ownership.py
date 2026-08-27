"""Row scope under site ownership and delegation.

Two features changed who can reach a project, and both are the kind of change
that is easy to get subtly wrong in the widening direction — where nothing fails
and somebody simply sees more than they should.

* **Source ownership.** A DCO owns *data sources*; a site deploys one; a
  project routes to the owner of its primary site's source. Read access follows
  any site whose source they own; write access follows ownership of the primary
  one.

  The indirection is the point. The same rig serving three projects has one
  owner, recorded once - before this it was recorded three times and nothing
  stopped those three disagreeing.
* **Delegation.** A DCO covering for another reaches the other's rows, for as
  long as the arrangement lasts and not a moment longer.

These assert against the repository, where the predicate is compiled into the
WHERE clause, because that is the level at which the property is real. A service
test would prove the service passed the right arguments, not that a row outside
scope is unselectable.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

import pytest

from cmp.core.permissions import Role
from cmp.db.repositories import projects as project_repo
from cmp.db.sql import fetch_one

pytestmark = pytest.mark.asyncio


async def _make_dco(conn: Any, name: str, email: str) -> int:
    row = await fetch_one(
        conn,
        """INSERT INTO auth_user (full_name, email, role, status)
           VALUES (%s, %s, 'dco', 'active') RETURNING id""",
        (name, email),
    )
    assert row is not None
    return int(row["id"])


async def _make_source(conn: Any, code: str, owner_user_id: int | None) -> int:
    """A data source, owned by somebody or by nobody.

    One per site in these tests. A shared source is a different property - that
    one owner reaches several projects - and is tested where it belongs rather
    than smuggled into every case here.
    """
    row = await fetch_one(
        conn,
        """INSERT INTO data_source (source_code, name, source_role, exchange_mode,
                                    owner_user_id)
           VALUES (%s, %s, 'collection', 'manual_upload', %s) RETURNING source_id""",
        (code, code, owner_user_id),
    )
    assert row is not None
    return int(row["source_id"])


async def _add_site(conn: Any, project_id: int, label: str, dco_user_id: int | None) -> int:
    """A site owned by somebody - which now means a site whose *source* they own.

    The signature still names a user because that is what every test here is
    actually saying. What changed underneath is where the answer is recorded.
    """
    source_id = await _make_source(conn, f"SRC-{label}-{project_id}-{dco_user_id}", dco_user_id)
    row = await fetch_one(
        conn,
        """INSERT INTO project_site (project_id, site_label, source_id)
           VALUES (%s, %s, %s) RETURNING site_id""",
        (project_id, label, source_id),
    )
    assert row is not None
    return int(row["site_id"])


async def _hand_site_to(conn: Any, site_id: int, dco_user_id: int) -> None:
    """Move a site to somebody else, by moving the source it deploys.

    Two ways to express this and they mean different things: reassigning the
    *source* moves every project deploying it, while attaching a different
    source moves only this site. This is the second - the site changes hands and
    nothing else does.
    """
    source_id = await _make_source(conn, f"SRC-MOVED-{site_id}-{dco_user_id}", dco_user_id)
    await conn.execute(
        "UPDATE project_site SET source_id = %s WHERE site_id = %s", (source_id, site_id)
    )


async def _project_owner(conn: Any, project_id: int) -> int | None:
    row = await fetch_one(
        conn, "SELECT dco_user_id FROM project WHERE project_id = %s", (project_id,)
    )
    return None if row is None else row["dco_user_id"]


class TestSiteRouting:
    """The project follows the primary site's owner."""

    async def test_assigning_the_first_owned_site_routes_the_project(
        self, conn: Any, seeded: dict[str, Any]
    ) -> None:
        arun = await _make_dco(conn, "Arun", "arun.route@test.local")
        project_id = seeded["project"]["project_id"]

        await _add_site(conn, project_id, "Bengaluru", arun)

        assert await _project_owner(conn, project_id) == arun

    async def test_moving_the_primary_site_moves_the_project(
        self, conn: Any, seeded: dict[str, Any]
    ) -> None:
        arun = await _make_dco(conn, "Arun", "arun.move@test.local")
        meera = await _make_dco(conn, "Meera", "meera.move@test.local")
        project_id = seeded["project"]["project_id"]
        site_id = await _add_site(conn, project_id, "Bengaluru", arun)

        await _hand_site_to(conn, site_id, meera)

        assert await _project_owner(conn, project_id) == meera

    async def test_a_later_site_does_not_take_the_project(
        self, conn: Any, seeded: dict[str, Any]
    ) -> None:
        """The *primary* site decides, and primary means earliest.

        Otherwise adding a site would silently move a project every time, and
        whoever registered last would own everything.
        """
        arun = await _make_dco(conn, "Arun", "arun.first@test.local")
        meera = await _make_dco(conn, "Meera", "meera.second@test.local")
        project_id = seeded["project"]["project_id"]

        await _add_site(conn, project_id, "Bengaluru", arun)
        await _add_site(conn, project_id, "Hyderabad", meera)

        assert await _project_owner(conn, project_id) == arun

    async def test_an_unowned_site_does_not_orphan_the_project(
        self, conn: Any, seeded: dict[str, Any]
    ) -> None:
        """Sites decide only when they have an opinion.

        A project assigned before any site existed must not lose its owner the
        moment somebody registers a location without saying who runs it. An
        orphaned project is invisible to every DCO, which is a worse failure
        than a stale owner and a much quieter one.
        """
        project_id = seeded["project"]["project_id"]
        before = await _project_owner(conn, project_id)
        assert before is not None, "fixture should seed a project with a DCO"

        await _add_site(conn, project_id, "Unstaffed lab", None)

        assert await _project_owner(conn, project_id) == before

    async def test_deactivating_the_primary_site_promotes_the_next(
        self, conn: Any, seeded: dict[str, Any]
    ) -> None:
        arun = await _make_dco(conn, "Arun", "arun.deact@test.local")
        meera = await _make_dco(conn, "Meera", "meera.deact@test.local")
        project_id = seeded["project"]["project_id"]
        first = await _add_site(conn, project_id, "Bengaluru", arun)
        await _add_site(conn, project_id, "Hyderabad", meera)

        await conn.execute(
            "UPDATE project_site SET status = 'terminated' WHERE site_id = %s", (first,)
        )

        assert await _project_owner(conn, project_id) == meera


class TestSiteScope:
    """Read follows any site held; write follows the primary one."""

    async def test_a_dco_holding_a_secondary_site_can_read_the_project(
        self, conn: Any, seeded: dict[str, Any]
    ) -> None:
        arun = await _make_dco(conn, "Arun", "arun.read@test.local")
        meera = await _make_dco(conn, "Meera", "meera.read@test.local")
        project_id = seeded["project"]["project_id"]
        project_uuid = str(seeded["project"]["project_uuid"])
        await _add_site(conn, project_id, "Bengaluru", arun)
        await _add_site(conn, project_id, "Hyderabad", meera)

        seen = await project_repo.by_uuid(conn, project_uuid, role=Role.DCO, user_id=meera)

        assert seen is not None, "a DCO running one of the sites has to see the study"

    async def test_a_dco_holding_a_secondary_site_cannot_write(
        self, conn: Any, seeded: dict[str, Any]
    ) -> None:
        arun = await _make_dco(conn, "Arun", "arun.write@test.local")
        meera = await _make_dco(conn, "Meera", "meera.write@test.local")
        project_id = seeded["project"]["project_id"]
        project_uuid = str(seeded["project"]["project_uuid"])
        await _add_site(conn, project_id, "Bengaluru", arun)
        await _add_site(conn, project_id, "Hyderabad", meera)

        writable = await project_repo.by_uuid(
            conn, project_uuid, role=Role.DCO, user_id=meera, write=True
        )

        assert writable is None, "only the owner of the primary site acts on the project"

    async def test_a_dco_with_no_site_on_the_project_sees_nothing(
        self, conn: Any, seeded: dict[str, Any]
    ) -> None:
        """The requirement in one assertion: a DCO must not see projects for
        sites that are not theirs."""
        arun = await _make_dco(conn, "Arun", "arun.none@test.local")
        stranger = await _make_dco(conn, "Stranger", "stranger.none@test.local")
        project_id = seeded["project"]["project_id"]
        await _add_site(conn, project_id, "Bengaluru", arun)

        seen = await project_repo.by_uuid(
            conn, str(seeded["project"]["project_uuid"]), role=Role.DCO, user_id=stranger
        )

        assert seen is None

    async def test_out_of_scope_is_404_not_403(self, conn: Any, seeded: dict[str, Any]) -> None:
        from cmp.core.errors import NotFound

        arun = await _make_dco(conn, "Arun", "arun.404@test.local")
        stranger = await _make_dco(conn, "Stranger", "stranger.404@test.local")
        await _add_site(conn, seeded["project"]["project_id"], "Bengaluru", arun)

        with pytest.raises(NotFound):
            await project_repo.require(
                conn, str(seeded["project"]["project_uuid"]), role=Role.DCO, user_id=stranger
            )


class TestDelegationScope:
    """Cover reaches the delegator's rows, and lapses on its own."""

    async def _delegate(
        self,
        conn: Any,
        *,
        frm: int,
        to: int,
        starts_at: datetime | None = None,
        ends_at: datetime | None = None,
    ) -> None:
        """`starts_at` is settable because `ends_after_start` refuses an
        arrangement that ended before it began — so an *expired* one has to be
        written with both dates in the past, not just the end."""
        await conn.execute(
            """INSERT INTO delegation
                 (delegator_user_id, delegate_user_id, starts_at, ends_at, created_by)
               VALUES (%s, %s, COALESCE(%s, now()), %s, %s)""",
            (frm, to, starts_at, ends_at, frm),
        )

    async def test_a_delegate_reaches_the_delegators_project(
        self, conn: Any, seeded: dict[str, Any]
    ) -> None:
        arun = await _make_dco(conn, "Arun", "arun.del@test.local")
        cover = await _make_dco(conn, "Cover", "cover.del@test.local")
        await _add_site(conn, seeded["project"]["project_id"], "Bengaluru", arun)

        before = await project_repo.by_uuid(
            conn, str(seeded["project"]["project_uuid"]), role=Role.DCO, user_id=cover
        )
        assert before is None, "no access before the arrangement exists"

        await self._delegate(conn, frm=arun, to=cover)

        after = await project_repo.by_uuid(
            conn, str(seeded["project"]["project_uuid"]), role=Role.DCO, user_id=cover
        )
        assert after is not None

    async def test_a_delegate_can_write_what_the_delegator_could(
        self, conn: Any, seeded: dict[str, Any]
    ) -> None:
        """Cover that can only look is not cover."""
        arun = await _make_dco(conn, "Arun", "arun.delw@test.local")
        cover = await _make_dco(conn, "Cover", "cover.delw@test.local")
        await _add_site(conn, seeded["project"]["project_id"], "Bengaluru", arun)
        await self._delegate(conn, frm=arun, to=cover)

        writable = await project_repo.by_uuid(
            conn, str(seeded["project"]["project_uuid"]), role=Role.DCO, user_id=cover, write=True
        )

        assert writable is not None

    async def test_an_expired_delegation_grants_nothing(
        self, conn: Any, seeded: dict[str, Any]
    ) -> None:
        """The point of a dated arrangement: it ends without anybody acting."""
        arun = await _make_dco(conn, "Arun", "arun.exp@test.local")
        cover = await _make_dco(conn, "Cover", "cover.exp@test.local")
        await _add_site(conn, seeded["project"]["project_id"], "Bengaluru", arun)
        now = datetime.now(UTC)
        await self._delegate(
            conn,
            frm=arun,
            to=cover,
            starts_at=now - timedelta(days=14),
            ends_at=now - timedelta(minutes=1),
        )

        seen = await project_repo.by_uuid(
            conn, str(seeded["project"]["project_uuid"]), role=Role.DCO, user_id=cover
        )

        assert seen is None

    async def test_a_revoked_delegation_grants_nothing(
        self, conn: Any, seeded: dict[str, Any]
    ) -> None:
        arun = await _make_dco(conn, "Arun", "arun.rev@test.local")
        cover = await _make_dco(conn, "Cover", "cover.rev@test.local")
        await _add_site(conn, seeded["project"]["project_id"], "Bengaluru", arun)
        await self._delegate(conn, frm=arun, to=cover)
        await conn.execute(
            "UPDATE delegation SET revoked_at = now(), revoked_by = %s "
            "WHERE delegator_user_id = %s",
            (arun, arun),
        )

        seen = await project_repo.by_uuid(
            conn, str(seeded["project"]["project_uuid"]), role=Role.DCO, user_id=cover
        )

        assert seen is None

    async def test_delegation_does_not_chain(self, conn: Any, seeded: dict[str, Any]) -> None:
        """A covers for B, B covers for C — A does not thereby reach C's rows.

        Transitive cover would let two ordinary arrangements compose into access
        neither person granted, which is the failure mode that makes delegation
        features dangerous.
        """
        arun = await _make_dco(conn, "Arun", "arun.chain@test.local")
        middle = await _make_dco(conn, "Middle", "middle.chain@test.local")
        far = await _make_dco(conn, "Far", "far.chain@test.local")
        await _add_site(conn, seeded["project"]["project_id"], "Bengaluru", arun)

        await self._delegate(conn, frm=arun, to=middle)
        await self._delegate(conn, frm=middle, to=far)

        seen = await project_repo.by_uuid(
            conn, str(seeded["project"]["project_uuid"]), role=Role.DCO, user_id=far
        )

        assert seen is None, "cover must not compose"
