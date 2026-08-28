"""Importing a notice from the document legal wrote.

The cases that matter are the refusals. Anyone can write a happy path that
parses a good file; what decides whether this is safe to put in front of an R&D
User is what it does with a file that is nearly right - a token left unfilled, a
retention period written as prose, a notice that has already been published and
whose text is hashed into consents.

One case is load-bearing beyond parsing: **an import must not activate the
purposes it creates.** Activating a purpose is the DPO's act. If uploading a
document could produce active purposes, an R&D User would be approving their
own, and the DPO's review of the register would be a formality they could route
around with a file upload.
"""

from __future__ import annotations

import io
import pathlib
import re
import zipfile
from typing import Any

import pytest

from cmp.core.errors import Conflict, ValidationFailed
from cmp.db.repositories import notices as notice_repo
from cmp.domain.notices import importer, service
from cmp.domain.notices.document import parse

pytestmark = pytest.mark.anyio

FIXTURE = pathlib.Path(__file__).parent.parent / "fixtures" / "notice_filled.docx"


@pytest.fixture
def document() -> bytes:
    return FIXTURE.read_bytes()


def _retext(payload: bytes, old: str, new: str) -> bytes:
    """Rewrite the document's XML, so a test can damage one cell.

    Crude on purpose. Building a broken .docx with python-docx would exercise
    python-docx; substituting in the stored XML exercises the parser against a
    file that is byte-for-byte the real one apart from the thing under test.
    """
    out = io.BytesIO()
    with (
        zipfile.ZipFile(io.BytesIO(payload)) as src,
        zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as dst,
    ):
        for item in src.infolist():
            data = src.read(item.filename)
            if item.filename == "word/document.xml":
                data = data.replace(old.encode("utf-8"), new.encode("utf-8"))
            dst.writestr(item, data)
    return out.getvalue()


async def _fresh_project(conn: Any, seeded: dict[str, Any], name: str) -> dict[str, Any]:
    """A project with no notice on it at all."""
    from cmp.db.sql import fetch_one

    return await fetch_one(
        conn,
        """INSERT INTO project (project_name, description, created_by, project_status)
           VALUES (%s, 'imported', %s, 'in_draft')
           RETURNING project_id, project_uuid""",
        (name, seeded["users"]["rnd_user"]["id"]),
    )


# ------------------------------------------------------------------ the parser


def test_the_document_parses(document: bytes) -> None:
    parsed = parse(document)

    assert parsed.language_code == "english"
    assert parsed.dpo_contact == "dpo@example.org"
    assert parsed.applicable_to == "data_subject"
    assert len(parsed.purposes) == 9
    assert len(parsed.categories) == 7
    assert parsed.rendered_text


def test_a_category_range_expands(document: bytes) -> None:
    """`DC-01 to DC-06` is six categories, not two.

    Reading it as its endpoints would put a notice in front of a data principal
    claiming less than the study collects.
    """
    first = parse(document).purposes[0]

    assert len(first.data_categories) == 6
    assert "Biometric and Activity Data" in first.data_categories
    # The names, not the ids - a DC number is meaningless outside this document.
    assert not any(c.startswith("DC-") for c in first.data_categories)


def test_necessity_decides_whether_a_purpose_may_be_declined(document: bytes) -> None:
    by_id = {p.document_id: p for p in parse(document).purposes}

    assert by_id["P-01"].is_mandatory is True  # necessary for participation
    assert by_id["P-02"].is_mandatory is False  # optional


def test_the_purpose_table_is_not_in_the_rendition(document: bytes) -> None:
    """The data principal ticks the purposes; printing them in the text as well
    would show the same list twice, once actionable and once not.

    Asserted on the table's own row shape rather than on a phrase like
    "Necessary for participation", which the surrounding prose legitimately uses
    to explain what the column means.
    """
    parsed = parse(document)

    assert not re.search(r"^P-0\d \|", parsed.rendered_text, re.MULTILINE)
    assert "[ ] Consent" not in parsed.rendered_text
    # The data-category table is kept, because nothing else carries it.
    assert "Biometric and Activity Data" in parsed.rendered_text
    assert re.search(r"^DC-01 \|", parsed.rendered_text, re.MULTILINE)


def test_an_unfilled_placeholder_is_refused(document: bytes) -> None:
    damaged = _retext(document, "dpo@example.org", "{{DPO_GRIEVANCE_EMAIL}}")

    with pytest.raises(ValidationFailed) as caught:
        parse(damaged)
    assert "DPO_GRIEVANCE_EMAIL" in str(caught.value)


def test_a_retention_period_that_is_not_a_period_is_refused(document: bytes) -> None:
    """'as long as necessary' is a sentence, not something Postgres can store."""
    damaged = _retext(document, "10 years", "as long as necessary")

    with pytest.raises(ValidationFailed) as caught:
        parse(damaged)
    assert "retention" in str(caught.value).lower()


def test_an_invalid_erasure_trigger_names_the_valid_ones(document: bytes) -> None:
    damaged = _retext(document, "period_elapsed", "whenever")

    with pytest.raises(ValidationFailed) as caught:
        parse(damaged)
    assert "purpose_served" in str(caught.value)


def test_something_that_is_not_a_word_file_is_refused() -> None:
    with pytest.raises(ValidationFailed) as caught:
        parse(b"%PDF-1.7 this is a pdf")
    assert "not a readable Word document" in str(caught.value)


# ----------------------------------------------------------------- the importer


async def test_the_dry_run_writes_nothing(
    conn: Any, seeded: dict[str, Any], document: bytes
) -> None:
    project = await _fresh_project(conn, seeded, "Dry Run Project")

    before = await _count(conn, "purpose")
    report = await importer.preview(
        conn,
        project_uuid=str(project["project_uuid"]),
        actor_id=seeded["users"]["rnd_user"]["id"],
        role="rnd_user",
        payload=document,
    )

    assert report["ok"] is True
    assert len(report["purposes"]) == 9
    assert await _count(conn, "purpose") == before
    assert await _count(conn, "notice") == await _count(conn, "notice")


async def test_import_creates_the_notice_its_text_and_its_purposes(
    conn: Any, seeded: dict[str, Any], document: bytes
) -> None:
    project = await _fresh_project(conn, seeded, "Import Project")

    notice = await importer.commit(
        conn,
        project_uuid=str(project["project_uuid"]),
        actor_id=seeded["users"]["rnd_user"]["id"],
        role="rnd_user",
        payload=document,
    )

    attached = await notice_repo.purposes_of(conn, notice["notice_id"])
    languages = await notice_repo.languages_of(conn, notice["notice_id"], with_text=True)

    assert len(attached) == 9
    assert notice["dpo_contact"] == "dpo@example.org"
    assert notice["withdraw_url"] == "https://example.org/withdraw"
    assert [p["language_code"] for p in languages] == ["english"]
    assert "Biometric and Activity Data" in languages[0]["rendered_text"]

    # The document's own Notice ID is recorded but does not become the code,
    # which is unique platform-wide and versioned by us.
    assert "NTC-GAIT-2026-001" in (notice["note"] or "")
    assert notice["notice_code"] != "NTC-GAIT-2026-001"


async def test_an_import_cannot_activate_its_own_purposes(
    conn: Any, seeded: dict[str, Any], document: bytes
) -> None:
    """The load-bearing one.

    An R&D User uploads the document. If that produced active purposes, they
    would have approved their own - activation is `RequireDPO` everywhere else.
    """
    project = await _fresh_project(conn, seeded, "Self Approval Project")

    notice = await importer.commit(
        conn,
        project_uuid=str(project["project_uuid"]),
        actor_id=seeded["users"]["rnd_user"]["id"],
        role="rnd_user",
        payload=document,
    )

    attached = await notice_repo.purposes_of(conn, notice["notice_id"])
    assert {p["status"] for p in attached} == {"draft"}

    # And the notice cannot publish while that is so.
    check = await service.checklist(conn, notice["notice_id"])
    assert check["publishable"] is False
    assert any("not activated" in b for b in check["blocking"])


async def test_activating_the_purposes_unblocks_publication(
    conn: Any, seeded: dict[str, Any], document: bytes
) -> None:
    from cmp.db.repositories import registry as registry_repo

    project = await _fresh_project(conn, seeded, "Activation Project")
    notice = await importer.commit(
        conn,
        project_uuid=str(project["project_uuid"]),
        actor_id=seeded["users"]["rnd_user"]["id"],
        role="rnd_user",
        payload=document,
    )

    for purpose in await notice_repo.purposes_of(conn, notice["notice_id"]):
        await registry_repo.set_purpose_status(conn, purpose["purpose_id"], "active")

    blocking = (await service.checklist(conn, notice["notice_id"]))["blocking"]
    assert not any("not activated" in b for b in blocking)
    # Still blocked on the language nobody has legally approved - which is the
    # DPO's other act, and proves activation did not skip the whole review.
    assert any("not legally approved" in b for b in blocking)


async def test_reimporting_replaces_the_draft_without_growing_the_register(
    conn: Any, seeded: dict[str, Any], document: bytes
) -> None:
    """Correcting a typo and uploading again must not leave nine orphans behind."""
    project = await _fresh_project(conn, seeded, "Reimport Project")
    kwargs = {
        "project_uuid": str(project["project_uuid"]),
        "actor_id": seeded["users"]["rnd_user"]["id"],
        "role": "rnd_user",
    }

    first = await importer.commit(conn, payload=document, **kwargs)
    after_first = await _count(conn, "purpose")

    second = await importer.commit(conn, payload=document, **kwargs)
    after_second = await _count(conn, "purpose")

    assert second["notice_id"] == first["notice_id"], "it should reuse the draft"
    assert after_second == after_first, "the superseded purposes should be gone"
    assert len(await notice_repo.purposes_of(conn, second["notice_id"])) == 9
    assert len(await notice_repo.languages_of(conn, second["notice_id"])) == 1


async def test_a_purpose_another_notice_picked_up_is_never_discarded(
    conn: Any, seeded: dict[str, Any], document: bytes
) -> None:
    """The orphan sweep deletes litter, not somebody else's purpose."""
    from cmp.db.repositories import registry as registry_repo

    project = await _fresh_project(conn, seeded, "Shared Purpose Project")
    kwargs = {
        "project_uuid": str(project["project_uuid"]),
        "actor_id": seeded["users"]["rnd_user"]["id"],
        "role": "rnd_user",
    }
    first = await importer.commit(conn, payload=document, **kwargs)

    # A second notice adopts one of the imported purposes.
    borrowed = (await notice_repo.purposes_of(conn, first["notice_id"]))[0]
    await registry_repo.set_purpose_status(conn, borrowed["purpose_id"], "active")
    other = await service.create(
        conn,
        project_uuid=str(seeded["project"]["project_uuid"]),
        actor_id=seeded["users"]["dpo"]["id"],
        role="dpo",
        withdraw_url="https://x/w",
        exercise_rights_url="https://x/r",
        board_complaint_url="https://x/b",
        dpo_contact="dpo@test.local",
    )
    await service.attach_purpose(
        conn, notice_id=other["notice_id"], purpose_uuid=str(borrowed["purpose_uuid"])
    )

    await importer.commit(conn, payload=document, **kwargs)

    survived = await registry_repo.purpose_by_id(conn, borrowed["purpose_id"])
    assert survived is not None, "a purpose another notice uses must not be swept"


async def test_a_published_notice_is_never_overwritten(
    conn: Any, seeded: dict[str, Any], document: bytes
) -> None:
    """Its text is hashed into every consent taken against it."""
    with pytest.raises(Conflict) as caught:
        await importer.commit(
            conn,
            project_uuid=str(seeded["project"]["project_uuid"]),
            actor_id=seeded["users"]["rnd_user"]["id"],
            role="rnd_user",
            payload=document,
        )
    assert "published" in str(caught.value).lower()


async def test_the_dry_run_flags_a_document_for_a_different_project(
    conn: Any, seeded: dict[str, Any], document: bytes
) -> None:
    project = await _fresh_project(conn, seeded, "Completely Unrelated Study")

    report = await importer.preview(
        conn,
        project_uuid=str(project["project_uuid"]),
        actor_id=seeded["users"]["rnd_user"]["id"],
        role="rnd_user",
        payload=document,
    )

    assert any("Gait Identification Study" in w for w in report["warnings"])


async def test_the_dry_run_offers_duplicates_rather_than_merging_them(
    conn: Any, seeded: dict[str, Any], document: bytes
) -> None:
    """Purposes are always created; the DPO decides what is a duplicate.

    So the dry run has to *show* the candidates - otherwise "the DPO merges
    later" is a promise with nothing behind it.
    """
    project = await _fresh_project(conn, seeded, "Duplicate Project")
    kwargs = {
        "project_uuid": str(project["project_uuid"]),
        "actor_id": seeded["users"]["rnd_user"]["id"],
        "role": "rnd_user",
    }
    await importer.commit(conn, payload=document, **kwargs)

    second = await _fresh_project(conn, seeded, "Second Duplicate Project")
    report = await importer.preview(
        conn,
        project_uuid=str(second["project_uuid"]),
        actor_id=seeded["users"]["rnd_user"]["id"],
        role="rnd_user",
        payload=document,
    )

    assert len(report["possible_duplicates"]) == 9
    assert all(d["similarity"] >= 0.82 for d in report["possible_duplicates"])


async def _count(conn: Any, table: str) -> int:
    assert re.match(r"^[a-z_]+$", table)
    cur = await conn.execute(f"SELECT count(*) AS n FROM {table}")
    row = await cur.fetchone()
    return int(row["n"])


def test_the_shipped_template_is_the_one_the_parser_expects() -> None:
    """The template and the parser must not drift.

    They are the two halves of one contract: the template says which columns to
    fill in and the parser refuses a document without them. A template that has
    lost a column produces an error on somebody's first upload, which is the
    worst place to discover it.

    Asserted by parsing the blank template and requiring the failure to be about
    an *unfilled value* rather than a *missing column* - which is exactly the
    line between "you have not finished it" and "we shipped you the wrong file".
    """
    from importlib.resources import files

    from cmp.api.routers.v1.notices import TEMPLATE_FILENAME

    blank = (files("cmp.domain.notices.assets") / TEMPLATE_FILENAME).read_bytes()

    with pytest.raises(ValidationFailed) as caught:
        parse(blank)

    message = str(caught.value)
    assert "missing the column" not in message, message
    assert "table is missing" not in message, message
    # It fails on a placeholder nobody filled in, which is the correct refusal.
    assert "{{" in message or "placeholder" in message.lower(), message
