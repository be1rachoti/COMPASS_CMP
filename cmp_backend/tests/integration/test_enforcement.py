"""Database enforcement.

These tests exist because "the application always calls the service layer" is a
claim about a codebase, and a codebase changes. A trigger is a claim about the
data, and this file is what verifies the claim.

Every test here bypasses the service layer on purpose and writes SQL directly. If
the guarantee only holds when you go through Python, it is not a guarantee.
"""

from __future__ import annotations

from itertools import pairwise
from typing import Any

import psycopg
import pytest

from cmp.core.security import content_hash

pytestmark = pytest.mark.integration


class TestAppendOnly:
    """Evidence tables refuse UPDATE and DELETE."""

    @pytest.mark.parametrize(
        "table",
        [
            "audit_log",
            "consent_artefact",
            "consent_purpose_grant",
            "export_log",
            "export_line",
            "project_status_history",
            "person_type_history",
            "project_approval",
        ],
    )
    async def test_delete_is_refused(self, conn: Any, table: str) -> None:
        with pytest.raises(psycopg.errors.InsufficientPrivilege) as exc:
            await conn.execute(f"DELETE FROM {table}")
        assert "append-only" in str(exc.value)
        assert "DELETE" in str(exc.value)

    @pytest.mark.parametrize(
        ("table", "column"),
        [
            ("audit_log", "occurred_at"),
            ("consent_artefact", "created_at"),
            ("export_log", "exported_at"),
            ("project_status_history", "occurred_at"),
            ("person_type_history", "changed_at"),
            ("project_approval", "uploaded_at"),
        ],
    )
    async def test_update_is_refused(self, conn: Any, table: str, column: str) -> None:
        """The trigger is statement-level, so it fires even against an empty table.

        Each table names a column it actually has: a statement that fails on an
        undefined column would pass this test for the wrong reason.
        """
        with pytest.raises(psycopg.errors.InsufficientPrivilege) as exc:
            await conn.execute(f"UPDATE {table} SET {column} = now()")
        assert "append-only" in str(exc.value)

    async def test_the_refusal_names_the_table_and_the_operation(self, conn: Any) -> None:
        """A guard rail that cannot explain itself gets diagnosed as a bug and
        disabled. This is the defect migration 0004 fixed."""
        with pytest.raises(psycopg.errors.InsufficientPrivilege) as exc:
            await conn.execute("DELETE FROM audit_log")
        message = str(exc.value)
        assert "audit_log is append-only" in message
        assert "DELETE is refused" in message
        assert "%" not in message  # the format() bug produced a literal '%'


class TestAuditChain:
    async def test_every_row_carries_its_predecessor(
        self, conn: Any, seeded: dict[str, Any]
    ) -> None:
        actor = seeded["users"]["dpo"]["id"]
        for i in range(3):
            await conn.execute(
                """INSERT INTO audit_log (event_type, actor_user_id, entity_type,
                                          entity_id, detail_json)
                   VALUES ('project.created', %s, 'project', %s, '{}'::jsonb)""",
                (actor, i),
            )

        cur = await conn.execute(
            "SELECT detail_json ->> '_hash' AS h, detail_json ->> '_prev' AS p "
            "FROM audit_log ORDER BY log_id"
        )
        rows = await cur.fetchall()

        assert len(rows) >= 3
        for previous, current in pairwise(rows):
            assert current["p"] == previous["h"], "chain link does not match"
            assert current["h"] and len(current["h"]) == 64

    async def test_verify_reports_an_intact_chain(
        self, conn: Any, seeded: dict[str, Any]
    ) -> None:
        await conn.execute(
            """INSERT INTO audit_log (event_type, actor_user_id, entity_type, entity_id)
               VALUES ('project.created', %s, 'project', 1)""",
            (seeded["users"]["dpo"]["id"],),
        )
        cur = await conn.execute("SELECT * FROM cmp_audit_verify()")
        assert await cur.fetchall() == []

    async def test_verify_detects_a_tampered_row(
        self, conn: Any, seeded: dict[str, Any]
    ) -> None:
        """The trigger refuses an UPDATE, so tampering means disabling it first -
        which is exactly what somebody with database access would do. The chain is
        the control that survives that.
        """
        actor = seeded["users"]["dpo"]["id"]
        for i in range(3):
            await conn.execute(
                """INSERT INTO audit_log (event_type, actor_user_id, entity_type, entity_id)
                   VALUES ('project.created', %s, 'project', %s)""",
                (actor, i),
            )

        cur = await conn.execute("SELECT log_id FROM audit_log ORDER BY log_id OFFSET 1 LIMIT 1")
        target = (await cur.fetchone())["log_id"]

        await conn.execute("ALTER TABLE audit_log DISABLE TRIGGER trg_audit_append_only")
        await conn.execute(
            "UPDATE audit_log SET event_type = 'project.closed' WHERE log_id = %s", (target,)
        )
        await conn.execute("ALTER TABLE audit_log ENABLE TRIGGER trg_audit_append_only")

        cur = await conn.execute("SELECT * FROM cmp_audit_verify()")
        breaks = await cur.fetchall()

        assert breaks, "a tampered row must break the chain"
        assert breaks[0]["log_id"] == target
        assert "hash" in breaks[0]["reason"]


class TestPublishedNoticeIsFrozen:
    async def test_notice_cannot_be_edited(self, conn: Any, seeded: dict[str, Any]) -> None:
        with pytest.raises(psycopg.errors.InsufficientPrivilege) as exc:
            await conn.execute(
                "UPDATE notice SET dpo_contact = 'attacker@evil.example' WHERE notice_id = %s",
                (seeded["notice"]["notice_id"],),
            )
        assert "immutable" in str(exc.value)

    async def test_served_text_cannot_be_rewritten(
        self, conn: Any, seeded: dict[str, Any]
    ) -> None:
        """INV-4: the words she was shown are the words that stay on the record."""
        with pytest.raises(psycopg.errors.InsufficientPrivilege) as exc:
            await conn.execute(
                "UPDATE notice_language SET rendered_text = 'Different words' "
                "WHERE notice_id = %s",
                (seeded["notice"]["notice_id"],),
            )
        assert "INV-4" in str(exc.value)

    async def test_purposes_cannot_change_after_publication(
        self, conn: Any, seeded: dict[str, Any]
    ) -> None:
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            await conn.execute(
                "DELETE FROM notice_purpose WHERE notice_id = %s",
                (seeded["notice"]["notice_id"],),
            )


class TestConsentCoherence:
    async def _artefact(self, conn: Any, seeded: dict[str, Any], **overrides: Any) -> None:
        params = {
            "user": seeded["subject"]["id"],
            "notice": seeded["notice"]["notice_id"],
            "language": seeded["language"]["notice_language_id"],
            "hash": seeded["language"]["content_hash"],
            "link": seeded["link"]["link_id"],
            **overrides,
        }
        await conn.execute(
            """INSERT INTO consent_artefact
                 (auth_user_id, notice_id, notice_language_id, notice_content_hash,
                  link_id, served_at, affirmative_action_at, action_type)
               VALUES (%(user)s, %(notice)s, %(language)s, %(hash)s, %(link)s,
                       now() - interval '1 minute', now(), 'checkbox_click')""",
            params,
        )

    async def test_a_coherent_artefact_is_accepted(
        self, conn: Any, seeded: dict[str, Any]
    ) -> None:
        await self._artefact(conn, seeded)
        # Scoped to this test's own subject. A global count would depend on
        # whatever else is committed in the database, which makes the test pass
        # or fail for reasons that have nothing to do with the behaviour.
        cur = await conn.execute(
            "SELECT count(*) AS n FROM consent_artefact WHERE auth_user_id = %s",
            (seeded["subject"]["id"],),
        )
        assert (await cur.fetchone())["n"] == 1

    async def test_wrong_content_hash_is_refused(
        self, conn: Any, seeded: dict[str, Any]
    ) -> None:
        """The artefact must carry the hash of the text actually served.

        Without this, an artefact could claim consent to text that was never
        rendered, and INV-4 would be unenforceable.
        """
        with pytest.raises(psycopg.errors.CheckViolation) as exc:
            await self._artefact(conn, seeded, hash=content_hash("some other text"))
        assert "INV-4" in str(exc.value)

    async def test_acting_before_the_notice_was_served_is_refused(
        self, conn: Any, seeded: dict[str, Any]
    ) -> None:
        """s.5(1): the notice must be given before or with the request for consent."""
        with pytest.raises(psycopg.errors.CheckViolation) as exc:
            await conn.execute(
                """INSERT INTO consent_artefact
                     (auth_user_id, notice_id, notice_language_id, notice_content_hash,
                      link_id, served_at, affirmative_action_at, action_type)
                   VALUES (%s, %s, %s, %s, %s, now(), now() - interval '1 minute',
                           'checkbox_click')""",
                (
                    seeded["subject"]["id"],
                    seeded["notice"]["notice_id"],
                    seeded["language"]["notice_language_id"],
                    seeded["language"]["content_hash"],
                    seeded["link"]["link_id"],
                ),
            )
        assert "served_before_action" in str(exc.value)

    async def test_one_artefact_may_be_superseded_only_once(
        self, conn: Any, seeded: dict[str, Any]
    ) -> None:
        """Two rows claiming the same predecessor fork the chain, and
        v_current_consent would then return neither."""
        await self._artefact(conn, seeded)
        cur = await conn.execute(
            "SELECT consent_id FROM consent_artefact WHERE auth_user_id = %s",
            (seeded["subject"]["id"],),
        )
        original = (await cur.fetchone())["consent_id"]

        for _ in range(2):
            try:
                await conn.execute(
                    """INSERT INTO consent_artefact
                         (auth_user_id, notice_id, notice_language_id, notice_content_hash,
                          link_id, served_at, affirmative_action_at, action_type,
                          is_withdrawal, supersedes_consent_id)
                       VALUES (%s, %s, %s, %s, %s, now(), now(), 'button_press', true, %s)""",
                    (
                        seeded["subject"]["id"],
                        seeded["notice"]["notice_id"],
                        seeded["language"]["notice_language_id"],
                        seeded["language"]["content_hash"],
                        seeded["link"]["link_id"],
                        original,
                    ),
                )
            except psycopg.errors.UniqueViolation:
                return
        pytest.fail("a second supersession of the same artefact must be refused")


class TestPurposeConstraints:
    async def test_empty_data_categories_is_refused(
        self, conn: Any, seeded: dict[str, Any]
    ) -> None:
        """Rule 3(b)(i) requires the categories itemised.

        The original constraint used `array_length(...) >= 1`, which returns NULL
        for an empty array - and a CHECK passes on NULL. Migration 0004 replaced
        it with `cardinality(...)`. This test is the regression guard.
        """
        with pytest.raises(psycopg.errors.CheckViolation) as exc:
            await conn.execute(
                """INSERT INTO purpose (purpose_code, name, description, uses,
                                        lawful_basis, data_categories, retention_period,
                                        retention_basis, erasure_trigger, created_by)
                   VALUES ('P-EMPTY', 'x', 'd', 'u', 'consent_s6', ARRAY[]::text[],
                           interval '1 year', 'business_policy', 'withdrawal', %s)""",
                (seeded["users"]["dpo"]["id"],),
            )
        assert "categories_not_empty" in str(exc.value)

    async def test_s6_purpose_must_not_carry_an_s7_clause(
        self, conn: Any, seeded: dict[str, Any]
    ) -> None:
        with pytest.raises(psycopg.errors.CheckViolation) as exc:
            await conn.execute(
                """INSERT INTO purpose (purpose_code, name, description, uses,
                                        lawful_basis, s7_clause, data_categories,
                                        retention_period, retention_basis,
                                        erasure_trigger, created_by)
                   VALUES ('P-BAD', 'x', 'd', 'u', 'consent_s6', 's7_other',
                           ARRAY['name'], interval '1 year', 'business_policy',
                           'withdrawal', %s)""",
                (seeded["users"]["dpo"]["id"],),
            )
        assert "s7_clause_required" in str(exc.value)

    async def test_s7_purpose_must_name_its_clause(
        self, conn: Any, seeded: dict[str, Any]
    ) -> None:
        with pytest.raises(psycopg.errors.CheckViolation):
            await conn.execute(
                """INSERT INTO purpose (purpose_code, name, description, uses,
                                        lawful_basis, data_categories, retention_period,
                                        retention_basis, erasure_trigger, created_by)
                   VALUES ('P-BAD2', 'x', 'd', 'u', 'legitimate_use_s7',
                           ARRAY['name'], interval '1 year', 'business_policy',
                           'withdrawal', %s)""",
                (seeded["users"]["dpo"]["id"],),
            )


class TestAssetConsent:
    async def _asset(self, conn: Any, seeded: dict[str, Any]) -> int:
        source = await (
            await conn.execute(
                """INSERT INTO data_source (source_code, name, source_role, exchange_mode)
                   VALUES ('SRC-T', 'Test source', 'collection', 'file_import')
                   RETURNING source_id"""
            )
        ).fetchone()
        batch = await (
            await conn.execute(
                """INSERT INTO import_batch (source_id, file_name, file_hash,
                                             declared_rows, imported_by)
                   VALUES (%s, 'm.csv', 'abc', 1, %s) RETURNING batch_id""",
                (source["source_id"], seeded["users"]["dco"]["id"]),
            )
        ).fetchone()
        collection = await (
            await conn.execute(
                """INSERT INTO collection (source_id, source_collection_ref, project_id,
                                           batch_id, collected_on)
                   VALUES (%s, 'C-1', %s, %s, current_date) RETURNING collection_id""",
                (source["source_id"], seeded["project"]["project_id"], batch["batch_id"]),
            )
        ).fetchone()
        asset = await (
            await conn.execute(
                """INSERT INTO data_asset (source_id, source_asset_ref, collection_id,
                                           asset_type)
                   VALUES (%s, 'A-1', %s, 'image') RETURNING asset_id""",
                (source["source_id"], collection["collection_id"]),
            )
        ).fetchone()
        return int(asset["asset_id"])

    async def test_a_bystander_row_is_permitted(
        self, conn: Any, seeded: dict[str, Any]
    ) -> None:
        """INV-12. Multi-subject capture includes people in frame who never
        consented. If the row cannot exist, a redact-before-release rule cannot be
        enforced against someone the system does not know is there.
        """
        asset_id = await self._asset(conn, seeded)
        await conn.execute(
            "INSERT INTO asset_consent (asset_id, consent_id, subject_role) "
            "VALUES (%s, NULL, 'incidental')",
            (asset_id,),
        )
        cur = await conn.execute(
            "SELECT count(*) AS n FROM asset_consent "
            "WHERE asset_id = %s AND consent_id IS NULL",
            (asset_id,),
        )
        assert (await cur.fetchone())["n"] == 1

    async def test_consented_without_a_consent_id_is_refused(
        self, conn: Any, seeded: dict[str, Any]
    ) -> None:
        asset_id = await self._asset(conn, seeded)
        with pytest.raises(psycopg.errors.CheckViolation) as exc:
            await conn.execute(
                "INSERT INTO asset_consent (asset_id, consent_id, subject_role) "
                "VALUES (%s, NULL, 'consented')",
                (asset_id,),
            )
        assert "consent_matches_role" in str(exc.value)


class TestLinkIntegrity:
    async def test_link_requires_an_approved_project(
        self, conn: Any, seeded: dict[str, Any]
    ) -> None:
        await conn.execute(
            "UPDATE project SET project_status = 'in_draft' WHERE project_id = %s",
            (seeded["project"]["project_id"],),
        )
        with pytest.raises(psycopg.errors.CheckViolation) as exc:
            await conn.execute(
                """INSERT INTO consent_link (notice_id, site_id, token, expires_at, created_by)
                   VALUES (%s, %s, 'another-token-000000000000000000',
                           now() + interval '1 day', %s)""",
                (
                    seeded["notice"]["notice_id"],
                    seeded["site"]["site_id"],
                    seeded["users"]["dco"]["id"],
                ),
            )
        assert "approved" in str(exc.value)
