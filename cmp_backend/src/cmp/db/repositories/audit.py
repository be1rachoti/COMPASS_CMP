"""Reading the audit trail.

Read-only by construction. There is no insert here - writes go through
`cmp.domain.audit.record` on the caller's transaction - and no update or delete
exists at any layer: the route is not registered, the grant is revoked from the
application role, and a database trigger refuses the statement.
"""

from __future__ import annotations

from collections.abc import Sequence
from datetime import datetime
from typing import Any

from cmp.core.pagination import PageRequest, build_page
from cmp.db.sql import Conn, Row, fetch_all, fetch_one, keyset_clause

LIST_SORTS = ("occurred_at",)

#: Events that are true, recorded, and not activity.
#:
#: Signing in is not something that happened *to the work*, and a feed that
#: leads with "you logged in" pushes out the notice somebody published. They
#: remain in the audit trail, where a DPO investigating access wants them and
#: knows to look; they are excluded from every activity feed.
#:
#: The same list the data-subject feed uses, for the same reason.
_NOT_ACTIVITY = (
    "auth.login_succeeded",
    "auth.login_failed",
    "auth.otp_requested",
    "auth.otp_verified",
    "auth.logout",
    "auth.mfa_verified",
)

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
        conn,
        f"SELECT l.log_id AS _row_id, {_SELECT}{_FROM} WHERE {clause}{keyset}",
        [*params, *kparams],
    )
    total = await fetch_one(conn, f"SELECT count(*) AS n {_FROM} WHERE {clause}", params)
    items, cursor = build_page(rows, req)
    return items, cursor, int((total or {}).get("n", 0))


async def by_uuid(conn: Conn, log_uuid: str) -> Row | None:
    return await fetch_one(conn, f"SELECT {_SELECT}{_FROM} WHERE l.log_uuid = %s", (log_uuid,))


async def for_subject(conn: Conn, subject_user_id: int, *, limit: int = 50) -> list[Row]:
    """ "What has happened to my data" - the DSAR query.

    Backed by idx_audit_subject. Events that are noise to the subject (her own
    page views, her own sign-ins) are excluded; what remains is what was done
    *with* her data.
    """
    return await fetch_all(
        conn,
        f"""
        SELECT {_SELECT}{_FROM}
        WHERE l.subject_user_id = %s
          AND l.event_type <> ALL(%s)
        ORDER BY l.occurred_at DESC
        LIMIT %s
        """,
        (subject_user_id, list(_NOT_ACTIVITY), limit),
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


# --------------------------------------------------------------- scoped feed
#
# Which audit rows belong to a project.
#
# The trail records what was touched as `(entity_type, entity_id)` — a table
# name and a surrogate key — because that is the only reference guaranteed to
# stay valid. Turning that back into "which project was this about" needs one
# join per table, and this is the map.
#
# Written as a UNION rather than a chain of ORs over LEFT JOINs so each branch
# uses its own index, and so a table added here cannot accidentally widen the
# others. A type absent from this map contributes no rows, which is the safe
# direction: a new entity type is invisible to the feed until somebody maps it,
# rather than leaking into everyone's.
_ENTITY_TO_PROJECT = """
  SELECT 'project'::text AS t, project_id AS id, project_id AS project_id FROM project
  UNION ALL SELECT 'notice', notice_id, project_id FROM notice
  UNION ALL SELECT 'project_site', site_id, project_id FROM project_site
  UNION ALL SELECT 'project_approval', approval_id, project_id FROM project_approval
  UNION ALL SELECT 'export_log', export_id, project_id FROM export_log
  UNION ALL SELECT 'collection', collection_id, project_id FROM collection
  UNION ALL SELECT 'consent_link', cl.link_id, n.project_id
              FROM consent_link cl JOIN notice n ON n.notice_id = cl.notice_id
  UNION ALL SELECT 'consent_artefact', ca.consent_id, n.project_id
              FROM consent_artefact ca JOIN notice n ON n.notice_id = ca.notice_id
"""


async def for_projects(conn: Conn, project_ids: Sequence[int], *, limit: int = 25) -> list[Row]:
    """Recent activity on a set of projects.

    This is what a dashboard's "recent activity" should be, and what it was not:
    the R&D User's showed rows from `project` ordered by `updated_at`, which
    says *that* something changed and never what or by whom. A person looking at
    it could see their project had moved and had to go elsewhere to find out who
    moved it.

    Same rows, same shape and same resolver as the DPO's audit trail — narrowed
    to projects the caller can reach. One feed, one renderer, and no second
    definition of what an activity entry is.

    An empty `project_ids` returns nothing rather than everything. That is worth
    stating: the natural SQL for "in this list" degenerates to a tautology on an
    empty list in some dialects, and the failure would be silent and total.
    """
    if not project_ids:
        return []

    return await fetch_all(
        conn,
        f"""
        SELECT {_SELECT}{_FROM}
        JOIN ({_ENTITY_TO_PROJECT}) m
          ON m.t = l.entity_type AND m.id = l.entity_id
        WHERE m.project_id = ANY(%s)
          AND l.event_type <> ALL(%s)
        ORDER BY l.occurred_at DESC
        LIMIT %s
        """,
        (list(project_ids), list(_NOT_ACTIVITY), limit),
    )


async def by_actor(conn: Conn, actor_user_id: int, *, limit: int = 25) -> list[Row]:
    """What this person did, most recent first.

    Complements `for_projects`: an R&D User's own actions are theirs to see even
    where the project has since moved to somebody else's scope.
    """
    return await fetch_all(
        conn,
        f"""
        SELECT {_SELECT}{_FROM}
        WHERE l.actor_user_id = %s
          AND l.event_type <> ALL(%s)
        ORDER BY l.occurred_at DESC
        LIMIT %s
        """,
        (actor_user_id, list(_NOT_ACTIVITY), limit),
    )


async def for_consent(conn: Conn, consent_ids: Sequence[int], *, limit: int = 100) -> list[Row]:
    """Everything recorded about one consent, oldest first.

    Takes a *set* of ids because a consent is a chain: giving it writes one
    artefact, withdrawing writes another that supersedes it, and a partial
    change writes a third. Asking for the trail of "this consent" means the
    whole chain, or the answer stops at whichever link the person happened to
    open.

    Ordered oldest-first, unlike every other feed here. A trail is read as a
    story — served, agreed, disclosed, withdrawn — and a story told backwards
    from an arbitrary point is harder to follow than one that starts at the
    start. There are rarely more than a handful of entries.
    """
    if not consent_ids:
        return []

    return await fetch_all(
        conn,
        f"""
        SELECT {_SELECT}{_FROM}
        WHERE l.entity_type = 'consent_artefact' AND l.entity_id = ANY(%s)
        ORDER BY l.occurred_at ASC
        LIMIT %s
        """,
        (list(consent_ids), limit),
    )


async def recent(conn: Conn, *, limit: int = 15, event_type: str | None = None) -> list[Row]:
    """The latest entries across every project.

    Unscoped, so only for callers who already read every row — a DPO and an
    administrator. There is no `user_id` parameter, and there should not be one:
    a scoped feed is `for_projects`, and a function that could do either
    depending on an argument is a function somebody will call with the wrong
    argument.
    """
    clause = "WHERE l.event_type = %s" if event_type else ""
    params: list[Any] = [event_type] if event_type else []
    return await fetch_all(
        conn,
        f"SELECT {_SELECT}{_FROM} {clause} ORDER BY l.occurred_at DESC LIMIT %s",
        [*params, limit],
    )
