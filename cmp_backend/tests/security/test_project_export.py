"""One CSV per project, and who is in it.

The export exists so an agent at the collection point can tell whom a consent is
against. That means it carries names, emails and mobile numbers - so what it
must never do is carry the wrong ones.

Two properties do the work here. The contents follow the *exporter's* scope, so
a collection owner's file holds the people who consented at the sites they run
and nobody else's. And a download re-renders from the export's own disclosure
record rather than re-running the query, so the file cannot change shape
underneath the person who generated it, or be rebuilt against whoever opens it.
"""

from __future__ import annotations

import csv
import io
from typing import Any

import pytest

from cmp.core.permissions import Role
from cmp.db.repositories import projects as project_repo
from cmp.db.sql import fetch_one
from cmp.domain.exchange import service as exchange_service

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


async def _site_with_consent(
    conn: Any,
    seeded: dict[str, Any],
    *,
    kind: str,
    code: str,
    label: str,
    owner: int,
    person: str,
    withdrawn: bool = False,
    sealed: bool = True,
) -> None:
    """A site somebody owns, with one person's consent taken there."""
    # Unique per person: `auth_user.mobile` is unique, and a shared number made
    # the second call in a test fail on a constraint rather than on the thing
    # under test.
    mobile = "+9190" + f"{abs(hash(person)) % 100000000:08d}"
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
           VALUES (%s, %s, %s, %s) RETURNING site_id""",
        (
            seeded["project"]["project_id"],
            label,
            source["source_id"],
            processor["processor_id"],
        ),
    )
    assert site is not None
    # Minted the way the service does: a real token, its keyed digest for
    # matching, and - unless the test is standing in for a pre-0011 link - the
    # sealed copy that lets the URL be shown again.
    from cmp.core.security import new_token, seal_token, token_fingerprint

    raw = new_token(32)
    link = await fetch_one(
        conn,
        """INSERT INTO consent_link (notice_id, site_id, token, token_sealed,
                                     expires_at, created_by)
           VALUES (%s, %s, %s, %s, now() + interval '7 days', %s)
           RETURNING link_id""",
        (
            seeded["notice"]["notice_id"],
            site["site_id"],
            token_fingerprint(raw)[:64],
            seal_token(raw) if sealed else None,
            seeded["users"]["dpo"]["id"],
        ),
    )
    assert link is not None
    subject = await fetch_one(
        conn,
        """INSERT INTO auth_user (full_name, email, mobile, role, status)
           VALUES (%s, %s, %s, 'data_subject', 'active') RETURNING id""",
        (person, f"{person.replace(' ', '.').lower()}@example.org", mobile),
    )
    assert subject is not None
    artefact = await fetch_one(
        conn,
        """INSERT INTO consent_artefact
                  (auth_user_id, notice_id, notice_language_id, notice_content_hash,
                   link_id, served_at, affirmative_action_at, action_type, is_withdrawal)
           VALUES (%s, %s, %s, %s, %s, now(), now(), 'checkbox_click', %s)
           RETURNING consent_id""",
        (
            subject["id"],
            seeded["notice"]["notice_id"],
            seeded["language"]["notice_language_id"],
            seeded["language"]["content_hash"],
            link["link_id"],
            withdrawn,
        ),
    )
    assert artefact is not None
    if not withdrawn:
        await conn.execute(
            """INSERT INTO consent_purpose_grant (consent_id, purpose_id, granted)
               VALUES (%s, %s, true)""",
            (artefact["consent_id"], seeded["purpose"]["purpose_id"]),
        )


async def _project(conn: Any, seeded: dict[str, Any]) -> dict[str, Any]:
    """The full project row, as `generate` fetches it.

    The fixture holds ids only; the export needs the name it puts on every row,
    so the tests take the same path the service does rather than a stand-in that
    would not have caught a missing column.
    """
    return await project_repo.require(
        conn,
        str(seeded["project"]["project_uuid"]),
        role=Role.DPO,
        user_id=seeded["users"]["dpo"]["id"],
    )


def _rows(payload: str) -> list[dict[str, str]]:
    return list(csv.DictReader(io.StringIO(payload)))


class TestItIsOneCsvWithThePeopleInIt:
    async def test_a_row_names_the_person_and_their_consent(
        self, conn: Any, seeded: dict[str, Any]
    ) -> None:
        """The whole point: an agent has to know whom the consent is against."""
        dco = await _owner(conn, "dco", "exp.dco@test.local")
        await _site_with_consent(
            conn,
            seeded,
            kind="external",
            code="SRC-X-1",
            label="CIT",
            owner=dco,
            person="Anjali Verma",
        )

        payload, count, lines = await exchange_service._project_export(
            conn, await _project(conn, seeded), role=Role.DCO, user_id=dco
        )
        rows = _rows(payload)
        assert count == 1
        assert len(lines) == 1, "one disclosure record per person named"

        row = rows[0]
        assert row["full_name"] == "Anjali Verma"
        assert row["email"] == "anjali.verma@example.org"
        assert row["mobile"].startswith("+9190")
        assert row["consent_uuid"]
        assert row["consent_status"] == "consented"
        # And the context, on the same row, which is what the two old files
        # made somebody join by hand.
        assert row["project_name"] == (await _project(conn, seeded))["project_name"]
        assert row["site_label"] == "CIT"
        assert row["notice_code"]
        assert row["notice_content_sha256"]

    async def test_a_withdrawal_is_in_it_and_says_so(
        self, conn: Any, seeded: dict[str, Any]
    ) -> None:
        """The row an agent most needs, and the one a consented-only list hides.

        Without it they cannot tell "withdrew, stop collecting" from "never
        turned up".
        """
        dco = await _owner(conn, "dco", "exp.wd@test.local")
        await _site_with_consent(
            conn,
            seeded,
            kind="external",
            code="SRC-X-2",
            label="CIT",
            owner=dco,
            person="Ravi Kumar",
            withdrawn=True,
        )

        payload, _, _ = await exchange_service._project_export(
            conn, await _project(conn, seeded), role=Role.DCO, user_id=dco
        )
        row = next(r for r in _rows(payload) if r["full_name"] == "Ravi Kumar")
        assert row["consent_status"] == "withdrawn"
        assert row["granted_purposes"] == ""

    async def test_no_consents_still_produces_a_usable_file(
        self, conn: Any, seeded: dict[str, Any]
    ) -> None:
        """A file of nothing but column names reads as a broken export."""
        stranger = await _owner(conn, "dco", "exp.empty@test.local")
        payload, count, lines = await exchange_service._project_export(
            conn, await _project(conn, seeded), role=Role.DCO, user_id=stranger
        )
        rows = _rows(payload)
        assert count == 0 and lines == []
        assert len(rows) == 1
        assert rows[0]["project_name"] == (await _project(conn, seeded))["project_name"]
        assert rows[0]["full_name"] == ""


class TestTheExportFollowsTheExportersScope:
    async def _two_owners(self, conn: Any, seeded: dict[str, Any]) -> dict[str, int]:
        dco = await _owner(conn, "dco", "scope.dco@test.local")
        rco = await _owner(conn, "rco", "scope.rco@test.local")
        await conn.execute(
            """INSERT INTO project_processor (project_id, processor_id, added_by, status)
               VALUES (%s, %s, %s, 'approved') ON CONFLICT DO NOTHING""",
            (
                seeded["project"]["project_id"],
                seeded["processors"]["in_house"]["processor_id"],
                seeded["users"]["rnd_user"]["id"],
            ),
        )
        await _site_with_consent(
            conn,
            seeded,
            kind="external",
            code="SRC-S-CIT",
            label="CIT",
            owner=dco,
            person="Campus Person",
        )
        await _site_with_consent(
            conn,
            seeded,
            kind="in_house",
            code="SRC-S-SE",
            label="SE",
            owner=rco,
            person="Lab Person",
        )
        return {"dco": dco, "rco": rco}

    async def test_each_owner_gets_only_their_own_sites_people(
        self, conn: Any, seeded: dict[str, Any]
    ) -> None:
        """An export that crossed the boundary would be a way around it - and a
        far worse one, because the result is a file that leaves the building."""
        who = await self._two_owners(conn, seeded)

        dco_csv, _, _ = await exchange_service._project_export(
            conn, await _project(conn, seeded), role=Role.DCO, user_id=who["dco"]
        )
        rco_csv, _, _ = await exchange_service._project_export(
            conn, await _project(conn, seeded), role=Role.RCO, user_id=who["rco"]
        )

        assert {r["full_name"] for r in _rows(dco_csv)} == {"Campus Person"}
        assert {r["full_name"] for r in _rows(rco_csv)} == {"Lab Person"}

    async def test_the_dpo_gets_everybody(self, conn: Any, seeded: dict[str, Any]) -> None:
        await self._two_owners(conn, seeded)
        payload, _, _ = await exchange_service._project_export(
            conn, await _project(conn, seeded), role=Role.DPO, user_id=seeded["users"]["dpo"]["id"]
        )
        assert {"Campus Person", "Lab Person"} <= {r["full_name"] for r in _rows(payload)}


class TestDownloadingReturnsWhatWasGenerated:
    async def test_a_later_consent_does_not_appear_in_an_earlier_export(
        self, conn: Any, seeded: dict[str, Any]
    ) -> None:
        """Re-running the query on download would fold in whatever matches now -
        and `file_hash` would then flag a mismatch on a file nobody changed."""
        dco = await _owner(conn, "dco", "dl.dco@test.local")
        await _site_with_consent(
            conn,
            seeded,
            kind="external",
            code="SRC-D-1",
            label="CIT",
            owner=dco,
            person="First Person",
        )

        export = await exchange_service.generate(
            conn,
            project_uuid=str(seeded["project"]["project_uuid"]),
            actor_id=dco,
            role=Role.DCO,
        )

        # Somebody consents afterwards, at the same site.
        await _site_with_consent(
            conn,
            seeded,
            kind="external",
            code="SRC-D-2",
            label="CIT2",
            owner=dco,
            person="Later Person",
        )

        payload, media, ext = await exchange_service.render(
            conn, {**export, "project_uuid": seeded["project"]["project_uuid"]}
        )
        names = {r["full_name"] for r in _rows(payload)}
        assert names == {"First Person"}
        assert media == "text/csv" and ext == "csv"

    async def test_the_file_is_the_same_bytes_it_was_hashed_as(
        self, conn: Any, seeded: dict[str, Any]
    ) -> None:
        """What `file_hash` is for: a download that differs from what was
        recorded is a changed disclosure, and must be detectable."""
        from cmp.core.security import file_hash

        dco = await _owner(conn, "dco", "hash.dco@test.local")
        await _site_with_consent(
            conn,
            seeded,
            kind="external",
            code="SRC-H-1",
            label="CIT",
            owner=dco,
            person="Hashed Person",
        )
        export = await exchange_service.generate(
            conn,
            project_uuid=str(seeded["project"]["project_uuid"]),
            actor_id=dco,
            role=Role.DCO,
        )
        payload, _, _ = await exchange_service.render(
            conn, {**export, "project_uuid": seeded["project"]["project_uuid"]}
        )
        assert file_hash(payload.encode("utf-8")) == export["file_hash"]


class TestTheGeneratedExportCanBeFound:
    """The download path, which the tests above skip.

    They call the builder and the renderer directly, so all of them passed while
    `export_by_uuid` inner-joined `project_site` on a column a project export
    leaves NULL. The export generated, recorded its disclosure, and then could
    not be found to download - visible only by driving the API.
    """

    async def test_a_project_export_is_retrievable_by_its_uuid(
        self, conn: Any, seeded: dict[str, Any]
    ) -> None:
        from cmp.db.repositories import exchange as exchange_repo

        dco = await _owner(conn, "dco", "find.dco@test.local")
        await _site_with_consent(
            conn,
            seeded,
            kind="external",
            code="SRC-F-1",
            label="CIT",
            owner=dco,
            person="Findable Person",
        )
        export = await exchange_service.generate(
            conn,
            project_uuid=str(seeded["project"]["project_uuid"]),
            actor_id=dco,
            role=Role.DCO,
        )

        found = await exchange_repo.export_by_uuid(
            conn, str(export["export_uuid"]), role=Role.DCO, user_id=dco
        )
        assert found is not None, "generated and then unfindable is the worst failure shape"
        assert found["site_uuid"] is None, "a project export covers every site it could see"
        assert found["project_name"]

    async def test_it_appears_in_the_projects_export_list(
        self, conn: Any, seeded: dict[str, Any]
    ) -> None:
        from cmp.db.repositories import exchange as exchange_repo

        dco = await _owner(conn, "dco", "list.dco@test.local")
        await _site_with_consent(
            conn,
            seeded,
            kind="external",
            code="SRC-F-2",
            label="CIT",
            owner=dco,
            person="Listed Person",
        )
        export = await exchange_service.generate(
            conn,
            project_uuid=str(seeded["project"]["project_uuid"]),
            actor_id=dco,
            role=Role.DCO,
        )

        rows = await exchange_repo.exports_for_project(conn, seeded["project"]["project_id"])
        assert str(export["export_uuid"]) in {str(r["export_uuid"]) for r in rows}


class TestTheConsentLinkIsNamedAndOpenable:
    """The link a consent came in through, with an address that works.

    This class previously asserted the opposite - that no column could carry a
    usable token - because the token was kept only as a keyed digest and the URL
    was unrecoverable by anyone. That was the stronger property and it was given
    up on purpose: the file is handed to whoever collects, and an identifier
    they cannot open is not a link.

    The assertions that remain are the ones still true, and the ones worth
    holding: the link is identified, its state is visible, and the *digest* -
    the value a request is matched against - is not what travels.
    """

    async def test_the_row_names_the_link_and_its_state(
        self, conn: Any, seeded: dict[str, Any]
    ) -> None:
        dco = await _owner(conn, "dco", "link.dco@test.local")
        await _site_with_consent(
            conn,
            seeded,
            kind="external",
            code="SRC-L-1",
            label="CIT",
            owner=dco,
            person="Linked Person",
        )

        payload, _, _ = await exchange_service._project_export(
            conn, await _project(conn, seeded), role=Role.DCO, user_id=dco
        )
        row = _rows(payload)[0]
        assert row["consent_link_uuid"]
        assert row["link_status"] == "active"
        assert row["link_expires_at"], "an agent needs to know the channel is still open"

    async def test_the_stored_digest_is_not_what_travels(
        self, conn: Any, seeded: dict[str, Any]
    ) -> None:
        """The token in the file is the credential the agent needs. The digest
        the database matches against is a different value and has no business
        leaving - printing it would disclose the lookup key for no benefit."""
        dco = await _owner(conn, "dco", "token.dco@test.local")
        await _site_with_consent(
            conn,
            seeded,
            kind="external",
            code="SRC-L-2",
            label="CIT",
            owner=dco,
            person="Token Person",
        )
        stored = await fetch_one(
            conn,
            """SELECT cl.token FROM consent_link cl
                 JOIN project_site s ON s.site_id = cl.site_id
                WHERE s.site_label = 'CIT' ORDER BY cl.link_id DESC LIMIT 1""",
        )
        assert stored is not None

        payload, _, _ = await exchange_service._project_export(
            conn, await _project(conn, seeded), role=Role.DCO, user_id=dco
        )
        assert stored["token"] not in payload


class TestTheLinkIsUsableAndStillProtected:
    """The export is handed to whoever collects, so the link has to open.

    That is a deliberate change to a property this system used to hold: the
    token was kept only as a keyed digest and the URL was unrecoverable by
    anyone. It is now sealed as well - encrypted under a key derived from the
    application secret, which lives outside the database - so the address can be
    shown again to the person who needs to share it.

    What these hold is the part that did *not* change: the database alone is
    still worth nothing.
    """

    async def test_the_row_carries_an_openable_link(
        self, conn: Any, seeded: dict[str, Any]
    ) -> None:
        from cmp.core.security import token_fingerprint

        dco = await _owner(conn, "dco", "url.dco@test.local")
        await _site_with_consent(
            conn,
            seeded,
            kind="external",
            code="SRC-U-1",
            label="CIT",
            owner=dco,
            person="Openable Person",
            sealed=True,
        )

        payload, _, _ = await exchange_service._project_export(
            conn, await _project(conn, seeded), role=Role.DCO, user_id=dco
        )
        row = _rows(payload)[0]
        assert row["consent_link_url"].startswith("/c/"), "an identifier is not a link"

        # And it is the real one: fingerprinting the token out of the URL finds
        # the row the request would be matched against.
        token = row["consent_link_url"].removeprefix("/c/")
        found = await fetch_one(
            conn,
            "SELECT link_uuid FROM consent_link WHERE token = %s",
            (token_fingerprint(token)[:64],),
        )
        assert found is not None, "the exported URL must resolve to its link"
        assert str(found["link_uuid"]) == row["consent_link_uuid"]

    async def test_a_link_minted_before_sealing_is_blank_not_broken(
        self, conn: Any, seeded: dict[str, Any]
    ) -> None:
        """Their tokens were never kept. An empty cell is honest; a made-up URL
        that 404s at the collection point is not."""
        dco = await _owner(conn, "dco", "old.dco@test.local")
        await _site_with_consent(
            conn,
            seeded,
            kind="external",
            code="SRC-U-2",
            label="CIT",
            owner=dco,
            person="Legacy Person",
            sealed=False,
        )

        payload, _, _ = await exchange_service._project_export(
            conn, await _project(conn, seeded), role=Role.DCO, user_id=dco
        )
        row = _rows(payload)[0]
        assert row["consent_link_url"] == ""
        assert row["consent_link_uuid"], "the link is still identified"

    async def test_the_database_alone_still_yields_nothing(
        self, conn: Any, seeded: dict[str, Any]
    ) -> None:
        """The property that survived the change, and the reason it is
        defensible: the sealing key is derived from the application secret,
        which is not in this database. A dump is still inert.
        """
        from cmp.core.security import unseal_token

        dco = await _owner(conn, "dco", "dump.dco@test.local")
        await _site_with_consent(
            conn,
            seeded,
            kind="external",
            code="SRC-U-3",
            label="CIT",
            owner=dco,
            person="Dumped Person",
            sealed=True,
        )
        stored = await fetch_one(
            conn,
            """SELECT cl.token, cl.token_sealed FROM consent_link cl
                 JOIN project_site s ON s.site_id = cl.site_id
                WHERE s.site_label = 'CIT' ORDER BY cl.link_id DESC LIMIT 1""",
        )
        assert stored is not None

        plain = unseal_token(stored["token_sealed"])
        assert plain, "the application can open it"
        # Neither stored column is the token itself.
        assert plain != stored["token"]
        assert plain.encode() not in bytes(stored["token_sealed"])
