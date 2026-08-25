"""Reading the audit trail.

Read-only by construction. There is no insert here - writes go through
`cmp.domain.audit.record` on the caller's transaction - and no update or delete
exists at any layer: the route is not registered, the grant is revoked from the
application role, and a database trigger refuses the statement.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from cmp.core.pagination import PageRequest, build_page
from cmp.db.sql import Conn, Row, fetch_all, fetch_one, keyset_clause

LIST_SORTS = ("occurred_at",)

_SELECT = """
  l.log_uuid, l.event_type, l.entity_type, l.entity_id, l.occurred_at,
  l.detail_json - '_hash' - '_prev' AS detail,
  actor.uuid   AS actor_uuid,   actor.full_name   AS actor_name,   actor.role AS actor_role,
  subject.uuid AS subject_uuid, subject.full_name AS subject_name
"""

_FROM = """
  FROM audit_log l
  LEFT JOIN auth_user actor   ON actor.id = l.actor_user_id
  LEFT JOIN auth_user subject ON subject.id = l.subject_user_id
"""


async def search(
    conn: Conn,
    req: PageRequest,
    *,
    actor_uuid: str | None = None,
    subject_uuid: str | None = None,
    entity_type: str | None = None,
    entity_id: int | None = None,
    event_type: str | None = None,
    date_from: datetime | None = None,
    date_to: datetime | None = None,
) -> tuple[list[Row], str | None, int]:
    where: list[str] = ["1 = 1"]
    params: list[Any] = []

    if actor_uuid:
        where.append("actor.uuid = %s")
        params.append(actor_uuid)
    if subject_uuid:
        where.append("subject.uuid = %s")
        params.append(subject_uuid)
    if entity_type:
        where.append("l.entity_type = %s")
        params.append(entity_type)
    if entity_id is not None:
        where.append("l.entity_id = %s")
        params.append(entity_id)
    if event_type:
        where.append("l.event_type = %s")
        params.append(event_type)
    if date_from:
        where.append("l.occurred_at >= %s")
        params.append(date_from)
    if date_to:
        where.append("l.occurred_at <= %s")
        params.append(date_to)

    clause = " AND ".join(where)
    keyset, kparams = keyset_clause(req, alias="l", id_column="log_id")
    rows = await fetch_all(
        conn, f"SELECT l.log_id AS _row_id, {_SELECT}{_FROM} WHERE {clause}{keyset}",
        [*params, *kparams],
    )
    total = await fetch_one(conn, f"SELECT count(*) AS n {_FROM} WHERE {clause}", params)
    items, cursor = build_page(rows, req)
    return items, cursor, int((total or {}).get("n", 0))


async def by_uuid(conn: Conn, log_uuid: str) -> Row | None:
    return await fetch_one(
        conn, f"SELECT {_SELECT}{_FROM} WHERE l.log_uuid = %s", (log_uuid,)
    )


async def for_subject(conn: Conn, subject_user_id: int, *, limit: int = 50) -> list[Row]:
    """"What has happened to my data" - the DSAR query.

    Backed by idx_audit_subject. Events that are noise to the subject (her own
    page views, her own sign-ins) are excluded; what remains is what was done
    *with* her data.
    """
    return await fetch_all(
        conn,
        f"""
        SELECT {_SELECT}{_FROM}
        WHERE l.subject_user_id = %s
          AND l.event_type NOT IN ('auth.login_succeeded', 'auth.login_failed',
                                   'auth.otp_requested', 'auth.otp_verified',
                                   'auth.logout', 'auth.mfa_verified')
        ORDER BY l.occurred_at DESC
        LIMIT %s
        """,
        (subject_user_id, limit),
    )


async def event_counts(conn: Conn, *, days: int = 7) -> list[Row]:
    return await fetch_all(
        conn,
        """
        SELECT event_type, count(*) AS n
        FROM audit_log
        WHERE occurred_at >= now() - make_interval(days => %s)
        GROUP BY event_type ORDER BY n DESC LIMIT 25
        """,
        (days,),
    )


async def denial_counts(conn: Conn, *, days: int = 7) -> int:
    row = await fetch_one(
        conn,
        """SELECT count(*) AS n FROM audit_log
           WHERE event_type = 'auth.access_denied'
             AND occurred_at >= now() - make_interval(days => %s)""",
        (days,),
    )
    return int((row or {}).get("n", 0))
