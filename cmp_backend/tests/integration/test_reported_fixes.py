"""Regressions for behaviour users reported as broken.

Each test names the complaint it came from. They go through the service layer
rather than raw SQL, because what was wrong in each case was a decision the
service made — the data was fine.
"""

from __future__ import annotations

from typing import Any

import pytest

from cmp.core.errors import NoticeIncomplete
from cmp.core.permissions import Role
from cmp.db.repositories import entities as entity_repo
from cmp.domain.notices import service as notice_service

pytestmark = pytest.mark.integration


class TestTransitionWithAnAlreadyPublishedNotice:
    """ "Unable to move the project to Under Process ... even though the notice
    is attached."

    The transition publishes the project's draft notice as part of moving. A DPO
    who published from the notice screen first left no draft behind, and the
    transition refused — insisting on its own preferred order of operations for a
    postcondition that was already satisfied.
    """

    async def test_a_published_notice_satisfies_the_transition(
        self, conn: Any, seeded: dict[str, Any]
    ) -> None:
        # The fixture publishes its notice, so there is no draft. Before the fix
        # this raised "The project has no draft notice to publish".
        result = await notice_service.publish_current(
            conn, project_id=seeded["project"]["project_id"], actor_id=seeded["users"]["dpo"]["id"]
        )
        assert result is not None
        assert result["status"] == "published"

    async def test_a_project_with_no_notice_at_all_is_still_refused(
        self, conn: Any, seeded: dict[str, Any]
    ) -> None:
        """The guard still guards. Only the *order* was relaxed, not the rule."""
        empty = await conn.execute(
            """INSERT INTO project (project_name, description, created_by, dco_user_id,
                                    project_status)
               VALUES ('No Notice Project', 'd', %s, %s, 'in_draft')
               RETURNING project_id""",
            (seeded["users"]["rnd_user"]["id"], seeded["users"]["dco"]["id"]),
        )
        project_id = (await empty.fetchone())["project_id"]

        with pytest.raises(NoticeIncomplete):
            await notice_service.publish_current(
                conn, project_id=project_id, actor_id=seeded["users"]["dpo"]["id"]
            )


class TestSiteIsNotRequiredToPublish:
    """ "Remove 'Add Site' mandatory from DPO view. Site should be added by RnD."

    Requiring a site to publish made the DPO invent one to get past their own
    screen, which puts a fiction in the recipients line of a notice a data
    subject reads.
    """

    async def test_checklist_does_not_block_on_a_missing_site(
        self, conn: Any, seeded: dict[str, Any]
    ) -> None:
        draft = await conn.execute(
            """INSERT INTO project (project_name, description, created_by, dco_user_id,
                                    project_status)
               VALUES ('Siteless Project', 'd', %s, %s, 'in_draft')
               RETURNING project_id""",
            (seeded["users"]["rnd_user"]["id"], seeded["users"]["dco"]["id"]),
        )
        project_id = (await draft.fetchone())["project_id"]

        notice = await notice_service.create(
            conn,
            project_uuid=str(
                (
                    await (
                        await conn.execute(
                            "SELECT project_uuid FROM project WHERE project_id = %s",
                            (project_id,),
                        )
                    ).fetchone()
                )["project_uuid"]
            ),
            actor_id=seeded["users"]["dpo"]["id"],
            role=Role.DPO,
            withdraw_url="https://x/w",
            exercise_rights_url="https://x/r",
            board_complaint_url="https://dpb.gov.in",
            dpo_contact="dpo@test.local",
            rendered_text="Text for the siteless check.",
        )

        checklist = await notice_service.checklist(conn, notice["notice_id"])
        assert not any("site" in item for item in checklist["blocking"]), checklist["blocking"]
        assert checklist["site_count"] == 0


class TestNoticeCreationConveniences:
    """ "New Notice should provide ability to add Text" and "Generate the Notice
    ID by system"."""

    async def test_code_is_generated_and_text_is_stored_in_one_call(
        self, conn: Any, seeded: dict[str, Any]
    ) -> None:
        notice = await notice_service.create(
            conn,
            project_uuid=str(seeded["project"]["project_uuid"]),
            actor_id=seeded["users"]["dpo"]["id"],
            role=Role.DPO,
            withdraw_url="https://x/w",
            exercise_rights_url="https://x/r",
            board_complaint_url="https://dpb.gov.in",
            dpo_contact="dpo@test.local",
            rendered_text="The generated-code notice text.",
        )

        assert notice["notice_code"].startswith("NTC-TEST-PROJECT-")
        languages = await notice_service.repo.languages_of(
            conn, notice["notice_id"], with_text=True
        )
        assert [x["language_code"] for x in languages] == ["english"]
        assert languages[0]["rendered_text"] == "The generated-code notice text."
        # A rendition that arrived with the notice is not thereby approved.
        assert languages[0]["approved_at"] is None


class TestCopyingANotice:
    """ "Provide ability to attach already available notice to the project."

    Copy, never share. `notice.project_id` is single-valued and every consent
    artefact records the notice served, so a shared row would make "which text,
    for which project" unanswerable.
    """

    async def test_copy_brings_purposes_and_text_but_not_approval(
        self, conn: Any, seeded: dict[str, Any]
    ) -> None:
        target = await conn.execute(
            """INSERT INTO project (project_name, description, created_by, dco_user_id,
                                    project_status)
               VALUES ('Copy Target', 'd', %s, %s, 'in_draft')
               RETURNING project_uuid""",
            (seeded["users"]["rnd_user"]["id"], seeded["users"]["dco"]["id"]),
        )
        target_uuid = str((await target.fetchone())["project_uuid"])

        copied = await notice_service.copy_from(
            conn,
            project_uuid=target_uuid,
            source_notice_uuid=str(seeded["notice"]["notice_uuid"]),
            actor_id=seeded["users"]["dpo"]["id"],
            role=Role.DPO,
        )

        assert copied["notice_uuid"] != seeded["notice"]["notice_uuid"]
        assert copied["status"] == "draft"
        assert copied["version"] == 1

        purposes = await notice_service.repo.purposes_of(conn, copied["notice_id"])
        languages = await notice_service.repo.languages_of(
            conn, copied["notice_id"], with_text=True
        )
        assert len(purposes) == 1
        assert len(languages) == 1
        # The source's rendition was approved. The copy's is not: a lawyer signed
        # that text off for the other project's recipients.
        assert languages[0]["approved_at"] is None


class TestAuditEntityResolution:
    """ "In Audit Trail currently only listing is there. User will not be able to
    see which notice and what details."

    The trail stores `notice#42` because that reference never goes stale. The
    resolver turns it into a name and a route at read time.
    """

    async def test_a_notice_reference_resolves_to_a_label_and_a_route(
        self, conn: Any, seeded: dict[str, Any]
    ) -> None:
        rows = [
            {"entity_type": "notice", "entity_id": seeded["notice"]["notice_id"]},
            {"entity_type": "project", "entity_id": seeded["project"]["project_id"]},
        ]
        resolved = await entity_repo.attach(conn, rows)

        assert resolved[0]["entity_label"].startswith("N-TEST v1")
        assert resolved[0]["entity_noun"] == "Notice"
        assert resolved[0]["entity_href"] == f"/notices/{seeded['notice']['notice_uuid']}"

        assert resolved[1]["entity_label"] == "Test Project"
        assert resolved[1]["entity_href"] == f"/projects/{seeded['project']['project_uuid']}"

    async def test_a_deleted_row_resolves_to_nothing_rather_than_failing(self, conn: Any) -> None:
        """The trail outlives what it describes.

        A page of audit rows must render even when one of them points at
        something that has since been removed — an evidence log that fails to
        load because of one dangling reference is not a log.
        """
        rows = [{"entity_type": "notice", "entity_id": 2_000_000_000}]
        resolved = await entity_repo.attach(conn, rows)
        assert resolved[0]["entity_label"] is None
        assert resolved[0]["entity_href"] is None

    async def test_an_unknown_entity_type_is_passed_through(self, conn: Any) -> None:
        """A table added to the backend but not to the resolver still renders."""
        rows = [{"entity_type": "some_future_table", "entity_id": 1}]
        resolved = await entity_repo.attach(conn, rows)
        assert resolved[0]["entity_label"] is None
