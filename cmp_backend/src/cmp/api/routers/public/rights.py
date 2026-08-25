"""Public information: the notice viewer and the rights page.

Separate from the consent flow because the audience is different. The flow is
walked once by somebody standing at a collection site with a link in their hand;
these two are for somebody who has *lost* the link, or who wants to check what a
notice said months later, or who is deciding whether to complain.

Both are unauthenticated. Neither reveals anything about an individual - the
notice viewer renders published text, which is public by construction, and the
rights page is the same for everyone.

Rule 9 and Rule 14(1). The Board complaint route is stated alongside the internal
grievance process, never instead of it: telling somebody only about the internal
route misstates the remedy available to them.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from fastapi import APIRouter, Response

from cmp.core.config import settings
from cmp.core.errors import NotFound
from cmp.db.pool import connection
from cmp.db.repositories import notices as notice_repo

router = APIRouter(tags=["public information"])


def _no_referrer(response: Response) -> None:
    """Keep a notice URL out of the next site's referrer header.

    A data subject who follows a link off the notice page should not hand the
    destination a URL saying which project they were reading about.
    """
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["Cache-Control"] = "no-store"


@router.get("/notice/{notice_uuid}", summary="Public notice viewer")
async def public_notice(
    notice_uuid: UUID, response: Response, language_code: str = "english"
) -> dict[str, Any]:
    """A published notice is a public document. Drafts are not visible here."""
    _no_referrer(response)
    async with connection() as conn:
        from cmp.db.sql import fetch_one

        notice = await fetch_one(
            conn,
            """SELECT n.notice_id, n.notice_uuid, n.notice_code, n.version, n.status,
                      n.withdraw_url, n.exercise_rights_url, n.board_complaint_url,
                      n.dpo_contact, n.recipients_text, n.published_at,
                      p.project_name
               FROM notice n JOIN project p ON p.project_id = n.project_id
               WHERE n.notice_uuid = %s AND n.status IN ('published','superseded')""",
            (str(notice_uuid),),
        )
        if not notice:
            raise NotFound("Notice")

        language = await notice_repo.language_row(
            conn, notice_id=notice["notice_id"], language_code=language_code
        )
        languages = await notice_repo.languages_of(conn, notice["notice_id"])
        purposes = await notice_repo.purposes_of(conn, notice["notice_id"])

    notice.pop("notice_id")
    return {
        "notice": notice,
        "language_code": language["language_code"] if language else None,
        "rendered_text": language["rendered_text"] if language else None,
        "content_hash": language["content_hash"] if language else None,
        "available_languages": [
            x["language_code"] for x in languages if x["approved_at"] is not None
        ],
        "purposes": [
            {"name": p["name"], "description": p["description"], "uses": p["uses"],
             "lawful_basis": p["lawful_basis"], "data_categories": p["data_categories"],
             "retention_period": str(p["retention_period"])}
            for p in purposes
        ],
        "superseded": notice["status"] == "superseded",
    }


@router.get("/rights", summary="How to make a rights request - Rule 9, Rule 14(1)")
async def rights(response: Response) -> dict[str, Any]:
    """Published so a data subject who has lost her notice can still find us.

    The Board complaint route is stated alongside ours, not instead of it: telling
    someone only about the internal grievance process misstates the remedy
    available to her.
    """
    _no_referrer(response)
    return {
        "dpo_contact": settings.notification_email_from,
        "how_to_exercise": [
            {
                "right": "Access",
                "section": "s.11",
                "description": (
                    "A summary of your personal data being processed, the "
                    "processing activities, and the identities of anyone it has "
                    "been shared with."
                ),
            },
            {
                "right": "Correction and erasure",
                "section": "s.12",
                "description": (
                    "Correction of inaccurate data, completion of incomplete data, "
                    "and erasure where the purpose is served or consent is withdrawn."
                ),
            },
            {
                "right": "Grievance redressal",
                "section": "s.13",
                "description": "Raise a grievance with us before approaching the Board.",
            },
            {
                "right": "Nominate",
                "section": "s.14",
                "description": (
                    "Nominate someone to exercise these rights on your behalf in "
                    "the event of death or incapacity."
                ),
            },
        ],
        "withdraw_consent": (
            "Sign in with the email or mobile you registered, open the consent "
            "record, and withdraw it in whole or per purpose. Withdrawal is as "
            "easy as giving consent was."
        ),
        "response_time": "We respond within the period prescribed by the DPDP Rules.",
        "board_complaint": (
            "If you are not satisfied with our response you may complain to the "
            "Data Protection Board of India. The route to the Board is independent "
            "of our grievance process."
        ),
    }
