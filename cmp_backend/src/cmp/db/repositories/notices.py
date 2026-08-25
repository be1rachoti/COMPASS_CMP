"""notice, notice_purpose, notice_language.

The notice is the artefact a data subject actually reads, so its integrity is the
integrity of the consent. Publication freezes the text and its hash; from then on
edits create a version rather than changing what was shown.
"""

from __future__ import annotations

from typing import Any

from cmp.core.pagination import PageRequest, build_page
from cmp.core.permissions import Role, Scope, scope_of
from cmp.db.sql import Conn, Row, fetch_all, fetch_one, keyset_clause

NOTICE_COLUMNS = """
  n.notice_uuid, n.notice_code, n.version, n.withdraw_url, n.exercise_rights_url,
  n.board_complaint_url, n.dpo_contact, n.recipients_text, n.status,
  n.change_class, n.published_at, n.created_at, n.updated_at
"""


def _project_scope(role: Role | str, user_id: int) -> tuple[str, list[Any]]:
    match scope_of("notice", role):
        case Scope.ALL:
            return "TRUE", []
        case Scope.SCOPED:
            return "p.dco_user_id = %s", [user_id]
        case Scope.OWN:
            return "p.created_by = %s", [user_id]
        case _:
            return "FALSE", []


async def by_uuid(conn: Conn, notice_uuid: str, *, role: Role | str, user_id: int) -> Row | None:
    pred, params = _project_scope(role, user_id)
    return await fetch_one(
        conn,
        f"""
        SELECT n.notice_id, {NOTICE_COLUMNS},
               p.project_uuid, p.project_name, p.project_id, p.project_status,
               a.uuid AS approved_by_uuid, a.full_name AS approved_by_name,
               (SELECT count(*) FROM notice_purpose np WHERE np.notice_id = n.notice_id)
                 AS purpose_count,
               (SELECT count(*) FROM notice_language nl WHERE nl.notice_id = n.notice_id)
                 AS language_count
        FROM notice n
        JOIN project p ON p.project_id = n.project_id
        LEFT JOIN auth_user a ON a.id = n.approved_by
        WHERE n.notice_uuid = %s AND ({pred})
        """,
        [notice_uuid, *params],
    )


async def by_id(conn: Conn, notice_id: int) -> Row | None:
    return await fetch_one(
        conn,
        f"""SELECT n.notice_id, {NOTICE_COLUMNS}, p.project_uuid, p.project_id, p.project_name
            FROM notice n JOIN project p ON p.project_id = n.project_id
            WHERE n.notice_id = %s""",
        (notice_id,),
    )


async def lock(conn: Conn, notice_id: int) -> Row:
    from cmp.db.sql import require_one

    return await require_one(
        conn,
        "SELECT notice_id, notice_code, version, status, project_id "
        "FROM notice WHERE notice_id = %s FOR UPDATE",
        (notice_id,),
        entity="Notice",
    )


async def create(
    conn: Conn,
    *,
    project_id: int,
    notice_code: str,
    version: int,
    withdraw_url: str,
    exercise_rights_url: str,
    board_complaint_url: str,
    dpo_contact: str,
    change_class: str | None = None,
) -> Row:
    row = await fetch_one(
        conn,
        """
        INSERT INTO notice (notice_code, project_id, version, withdraw_url,
                            exercise_rights_url, board_complaint_url, dpo_contact, change_class)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s::change_class)
        RETURNING notice_id, notice_uuid, notice_code, version, withdraw_url,
                  exercise_rights_url, board_complaint_url, dpo_contact, recipients_text,
                  status, change_class, published_at, created_at, updated_at
        """,
        (
            notice_code,
            project_id,
            version,
            withdraw_url,
            exercise_rights_url,
            board_complaint_url,
            dpo_contact,
            change_class,
        ),
    )
    assert row is not None
    return row


async def update_draft(conn: Conn, notice_id: int, **f: Any) -> Row:
    row = await fetch_one(
        conn,
        """
        UPDATE notice SET
          withdraw_url        = COALESCE(%(withdraw_url)s, withdraw_url),
          exercise_rights_url = COALESCE(%(exercise_rights_url)s, exercise_rights_url),
          board_complaint_url = COALESCE(%(board_complaint_url)s, board_complaint_url),
          dpo_contact         = COALESCE(%(dpo_contact)s, dpo_contact),
          change_class        = COALESCE(%(change_class)s::change_class, change_class)
        WHERE notice_id = %(notice_id)s
        RETURNING notice_id, notice_uuid, notice_code, version, withdraw_url,
                  exercise_rights_url, board_complaint_url, dpo_contact, recipients_text,
                  status, change_class, published_at, created_at, updated_at
        """,
        {**f, "notice_id": notice_id},
    )
    assert row is not None
    return row


async def list_for_project(conn: Conn, project_id: int) -> list[Row]:
    return await fetch_all(
        conn,
        f"""SELECT n.notice_id, {NOTICE_COLUMNS},
            (SELECT count(*) FROM notice_purpose np WHERE np.notice_id = n.notice_id)
              AS purpose_count,
            (SELECT count(*) FROM notice_language nl WHERE nl.notice_id = n.notice_id)
              AS language_count
            FROM notice n WHERE n.project_id = %s
            ORDER BY n.version DESC, n.notice_id DESC""",
        (project_id,),
    )


async def versions(conn: Conn, notice_code: str) -> list[Row]:
    return await fetch_all(
        conn,
        f"""SELECT n.notice_id, {NOTICE_COLUMNS} FROM notice n
            WHERE n.notice_code = %s ORDER BY n.version DESC""",
        (notice_code,),
    )


async def max_version(conn: Conn, notice_code: str) -> int:
    row = await fetch_one(
        conn,
        "SELECT coalesce(max(version), 0) AS v FROM notice WHERE notice_code = %s",
        (notice_code,),
    )
    return int((row or {}).get("v", 0))


async def publish(conn: Conn, notice_id: int, *, recipients_text: str, approved_by: int) -> Row:
    row = await fetch_one(
        conn,
        """
        UPDATE notice
           SET status = 'published', recipients_text = %s, approved_by = %s, published_at = now()
         WHERE notice_id = %s
        RETURNING notice_id, notice_uuid, notice_code, version, status,
                  recipients_text, published_at
        """,
        (recipients_text, approved_by, notice_id),
    )
    assert row is not None
    return row


async def supersede(conn: Conn, notice_id: int) -> None:
    await conn.execute("UPDATE notice SET status = 'superseded' WHERE notice_id = %s", (notice_id,))


# ------------------------------------------------------------ notice_purpose
async def attach_purpose(
    conn: Conn, *, notice_id: int, purpose_id: int, display_order: int, is_mandatory: bool
) -> Row:
    row = await fetch_one(
        conn,
        """
        INSERT INTO notice_purpose (notice_id, purpose_id, display_order, is_mandatory)
        VALUES (%s, %s, %s, %s)
        ON CONFLICT (notice_id, purpose_id)
          DO UPDATE SET display_order = EXCLUDED.display_order,
                        is_mandatory  = EXCLUDED.is_mandatory
        RETURNING notice_purpose_id, display_order, is_mandatory
        """,
        (notice_id, purpose_id, display_order, is_mandatory),
    )
    assert row is not None
    return row


async def detach_purpose(conn: Conn, *, notice_id: int, purpose_id: int) -> int:
    cur = await conn.execute(
        "DELETE FROM notice_purpose WHERE notice_id = %s AND purpose_id = %s",
        (notice_id, purpose_id),
    )
    return cur.rowcount


async def purposes_of(conn: Conn, notice_id: int) -> list[Row]:
    return await fetch_all(
        conn,
        """
        -- purpose_id is included because the consent service needs it to write
        -- grants. It must never reach a response: every route that returns these
        -- rows declares a response model, which filters it out.
        SELECT p.purpose_id,
               p.purpose_uuid, p.purpose_code, p.name, p.description, p.uses,
               p.lawful_basis, p.s7_clause, p.data_categories, p.retention_period,
               p.retention_basis, p.erasure_trigger, p.cross_border_permitted,
               p.permitted_for_minors, p.status,
               np.display_order, np.is_mandatory
        FROM notice_purpose np
        JOIN purpose p ON p.purpose_id = np.purpose_id
        WHERE np.notice_id = %s
        ORDER BY np.display_order, p.name
        """,
        (notice_id,),
    )


# ----------------------------------------------------------- notice_language
async def upsert_language(
    conn: Conn,
    *,
    notice_id: int,
    language_code: str,
    rendered_text: str,
    content_hash: str,
    created_by: int,
) -> Row:
    row = await fetch_one(
        conn,
        """
        INSERT INTO notice_language (notice_id, language_code, rendered_text,
                                     content_hash, created_by)
        VALUES (%s, %s::language_code, %s, %s, %s)
        ON CONFLICT (notice_id, language_code)
          DO UPDATE SET rendered_text = EXCLUDED.rendered_text,
                        content_hash  = EXCLUDED.content_hash,
                        approved_by   = NULL,
                        approved_at   = NULL
        RETURNING notice_language_id, notice_language_uuid, language_code,
                  content_hash, approved_at, created_at, updated_at
        """,
        (notice_id, language_code, rendered_text, content_hash, created_by),
    )
    assert row is not None
    return row


async def approve_language(
    conn: Conn, *, notice_id: int, language_code: str, approved_by: int
) -> Row | None:
    return await fetch_one(
        conn,
        """
        UPDATE notice_language
           SET approved_by = %s, approved_at = now()
         WHERE notice_id = %s AND language_code = %s::language_code
        RETURNING notice_language_uuid, language_code, content_hash, approved_at
        """,
        (approved_by, notice_id, language_code),
    )


async def languages_of(conn: Conn, notice_id: int, *, with_text: bool = False) -> list[Row]:
    text_col = "nl.rendered_text," if with_text else ""
    return await fetch_all(
        conn,
        f"""
        SELECT nl.notice_language_uuid, nl.language_code, {text_col}
               nl.content_hash, nl.approved_at, nl.created_at, nl.updated_at,
               a.uuid AS approved_by_uuid, a.full_name AS approved_by_name
        FROM notice_language nl
        LEFT JOIN auth_user a ON a.id = nl.approved_by
        WHERE nl.notice_id = %s
        ORDER BY nl.language_code
        """,
        (notice_id,),
    )


async def language_row(conn: Conn, *, notice_id: int, language_code: str) -> Row | None:
    return await fetch_one(
        conn,
        """SELECT notice_language_id, notice_language_uuid, language_code, rendered_text,
                  content_hash, approved_at
           FROM notice_language
           WHERE notice_id = %s AND language_code = %s::language_code""",
        (notice_id, language_code),
    )


async def recipients_text(conn: Conn, project_id: int) -> str:
    """Generated from project_site at publication, never typed by hand.

    A hand-typed recipient list is a list that stops matching the sites the data
    actually goes to, and the notice then misstates the disclosure.
    """
    rows = await fetch_all(
        conn,
        """
        SELECT s.site_label, s.location, pr.legal_name AS processor_name
        FROM project_site s
        LEFT JOIN processor pr ON pr.processor_id = s.processor_id
        WHERE s.project_id = %s AND s.status = 'active'
        ORDER BY s.site_label
        """,
        (project_id,),
    )
    if not rows:
        return "No external recipients. Processed only within the organisation."

    parts = []
    for r in rows:
        label = r["site_label"]
        if r["processor_name"]:
            label = f"{label} (operated by {r['processor_name']})"
        if r["location"]:
            label = f"{label}, {r['location']}"
        parts.append(label)
    return "; ".join(parts)


# ---------------------------------------------------- cross-project listing
LIST_SORTS = ("created_at", "published_at", "version")


async def list_all(
    conn: Conn,
    req: PageRequest,
    *,
    role: Role | str,
    user_id: int,
    status: str | None = None,
    project_uuid: str | None = None,
) -> tuple[list[Row], str | None, int]:
    """Every notice this caller may see, across projects.

    The per-project route answers "what does this project have"; the console's
    Notices section asks "what is outstanding anywhere", which is a different
    question and cannot be assembled client-side without N+1 requests.
    """
    pred, params_scope = _project_scope(role, user_id)
    where = [pred]
    params: list[Any] = [*params_scope]

    if status:
        where.append("n.status = %s::notice_status")
        params.append(status)
    if project_uuid:
        where.append("p.project_uuid = %s")
        params.append(project_uuid)

    clause = " AND ".join(where)
    keyset, kparams = keyset_clause(req, alias="n", id_column="notice_id")
    base = " FROM notice n JOIN project p ON p.project_id = n.project_id "

    rows = await fetch_all(
        conn,
        f"""SELECT n.notice_id AS _row_id, {NOTICE_COLUMNS},
            p.project_uuid, p.project_name,
            (SELECT count(*) FROM notice_purpose np WHERE np.notice_id = n.notice_id)
              AS purpose_count,
            (SELECT count(*) FROM notice_language nl WHERE nl.notice_id = n.notice_id)
              AS language_count,
            (SELECT count(*) FROM notice_language nl
              WHERE nl.notice_id = n.notice_id AND nl.approved_at IS NULL)
              AS unapproved_languages
            {base} WHERE {clause}{keyset}""",
        [*params, *kparams],
    )
    total = await fetch_one(conn, f"SELECT count(*) AS n {base} WHERE {clause}", params)
    items, cursor = build_page(rows, req)
    return items, cursor, int((total or {}).get("n", 0))
