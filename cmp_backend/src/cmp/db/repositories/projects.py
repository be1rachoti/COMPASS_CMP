"""project, project_status_history, project_approval, project_site.

Row scope lives here, in the WHERE clause, because that is the only place it is
real. `_scope_predicate` is applied to every read a scoped caller can reach:

* DPO      - every row.
* DCO      - projects they are the nominated DCO of.
* RnD User - projects they created.
* Admin    - none. Administrators manage accounts, not collections.

A caller outside scope gets no row, which surfaces as 404. That is deliberate:
403 would confirm the project exists.
"""

from __future__ import annotations

from typing import Any

from cmp.core.pagination import PageRequest, build_page
from cmp.core.permissions import Role, Scope, scope_of
from cmp.db.sql import Conn, Row, fetch_all, fetch_one, keyset_clause, require_one

PROJECT_COLUMNS = """
  p.project_uuid, p.project_name, p.internal_project_name, p.description,
  p.requesting_team, p.project_status, p.created_at, p.updated_at
"""


def _scope_predicate(role: Role | str, user_id: int) -> tuple[str, list[Any]]:
    """The WHERE fragment that implements row scope for this role."""
    scope = scope_of("project", role)
    match scope:
        case Scope.ALL:
            return "TRUE", []
        case Scope.SCOPED:
            return "p.dco_user_id = %s", [user_id]
        case Scope.OWN:
            return "p.created_by = %s", [user_id]
        case _:
            return "FALSE", []


async def by_uuid(
    conn: Conn, project_uuid: str, *, role: Role | str, user_id: int
) -> Row | None:
    pred, params = _scope_predicate(role, user_id)
    return await fetch_one(
        conn,
        f"""
        SELECT p.project_id, {PROJECT_COLUMNS},
               creator.uuid AS created_by_uuid, creator.full_name AS created_by_name,
               dco.uuid     AS dco_uuid,        dco.full_name     AS dco_name,
               n.notice_uuid AS current_notice_uuid
        FROM project p
        JOIN auth_user creator ON creator.id = p.created_by
        LEFT JOIN auth_user dco ON dco.id = p.dco_user_id
        LEFT JOIN notice n ON n.notice_id = p.current_notice_id
        WHERE p.project_uuid = %s AND ({pred})
        """,
        [project_uuid, *params],
    )


async def require(conn: Conn, project_uuid: str, *, role: Role | str, user_id: int) -> Row:
    row = await by_uuid(conn, project_uuid, role=role, user_id=user_id)
    if row is None:
        from cmp.core.errors import NotFound

        raise NotFound("Project")
    return row


async def require_for_update(conn: Conn, project_id: int) -> Row:
    """Lock the row for a transition.

    `FOR UPDATE` is what stops two DPOs approving the same project concurrently
    and writing two history rows for one change. The lock is held for the
    remainder of the transaction, which is why transitions keep their
    transactions short.
    """
    return await require_one(
        conn,
        "SELECT project_id, project_uuid, project_status, created_by, dco_user_id, "
        "current_notice_id FROM project WHERE project_id = %s FOR UPDATE",
        (project_id,),
        entity="Project",
    )


async def create(
    conn: Conn,
    *,
    project_name: str,
    description: str,
    internal_project_name: str | None,
    requesting_team: str | None,
    created_by: int,
    dco_user_id: int | None,
) -> Row:
    row = await fetch_one(
        conn,
        """
        INSERT INTO project (project_name, internal_project_name, description,
                             requesting_team, created_by, dco_user_id)
        VALUES (%s, %s, %s, %s, %s, %s)
        RETURNING project_id, project_uuid, project_name, internal_project_name,
                  description, requesting_team, project_status, created_at, updated_at
        """,
        (project_name, internal_project_name, description, requesting_team,
         created_by, dco_user_id),
    )
    assert row is not None
    return row


async def update_draft(
    conn: Conn,
    project_id: int,
    *,
    project_name: str | None,
    internal_project_name: str | None,
    description: str | None,
    requesting_team: str | None,
) -> Row:
    row = await fetch_one(
        conn,
        """
        UPDATE project
           SET project_name          = COALESCE(%s, project_name),
               internal_project_name = COALESCE(%s, internal_project_name),
               description           = COALESCE(%s, description),
               requesting_team       = COALESCE(%s, requesting_team)
         WHERE project_id = %s
        RETURNING project_id, project_uuid, project_name, internal_project_name,
                  description, requesting_team, project_status, created_at, updated_at
        """,
        (project_name, internal_project_name, description, requesting_team, project_id),
    )
    assert row is not None
    return row


async def set_status(conn: Conn, project_id: int, status: str) -> None:
    await conn.execute(
        "UPDATE project SET project_status = %s::project_status WHERE project_id = %s",
        (status, project_id),
    )


async def set_dco(conn: Conn, project_id: int, dco_user_id: int) -> None:
    await conn.execute(
        "UPDATE project SET dco_user_id = %s WHERE project_id = %s", (dco_user_id, project_id)
    )


async def set_current_notice(conn: Conn, project_id: int, notice_id: int) -> None:
    await conn.execute(
        "UPDATE project SET current_notice_id = %s WHERE project_id = %s",
        (notice_id, project_id),
    )


async def record_transition(
    conn: Conn,
    *,
    project_id: int,
    from_status: str | None,
    to_status: str,
    reason: str | None,
    actor_user_id: int,
) -> Row:
    row = await fetch_one(
        conn,
        """
        INSERT INTO project_status_history
               (project_id, from_status, to_status, reason, actor_user_id)
        VALUES (%s, %s::project_status, %s::project_status, %s, %s)
        RETURNING history_uuid, from_status, to_status, reason, occurred_at
        """,
        (project_id, from_status, to_status, reason, actor_user_id),
    )
    assert row is not None
    return row


async def history(conn: Conn, project_id: int) -> list[Row]:
    return await fetch_all(
        conn,
        """
        SELECT h.history_uuid, h.from_status, h.to_status, h.reason, h.occurred_at,
               a.uuid AS actor_uuid, a.full_name AS actor_name, a.role AS actor_role
        FROM project_status_history h
        JOIN auth_user a ON a.id = h.actor_user_id
        WHERE h.project_id = %s
        ORDER BY h.occurred_at DESC, h.history_id DESC
        """,
        (project_id,),
    )


LIST_SORTS = ("created_at", "updated_at", "project_name", "project_status")


async def list_projects(
    conn: Conn,
    req: PageRequest,
    *,
    role: Role | str,
    user_id: int,
    project_status: str | None = None,
    q: str | None = None,
) -> tuple[list[Row], str | None, int]:
    pred, scope_params = _scope_predicate(role, user_id)
    where = [pred]
    params: list[Any] = [*scope_params]

    if project_status:
        where.append("p.project_status = %s::project_status")
        params.append(project_status)
    if q:
        where.append("(p.project_name ILIKE %s OR p.internal_project_name ILIKE %s)")
        params.extend([f"%{q}%", f"%{q}%"])

    clause = " AND ".join(where)
    keyset, keyset_params = keyset_clause(req, alias="p", id_column="project_id")

    rows = await fetch_all(
        conn,
        f"""
        SELECT p.project_id AS _row_id, {PROJECT_COLUMNS},
               dco.uuid AS dco_uuid, dco.full_name AS dco_name,
               creator.full_name AS created_by_name
        FROM project p
        JOIN auth_user creator ON creator.id = p.created_by
        LEFT JOIN auth_user dco ON dco.id = p.dco_user_id
        WHERE {clause}{keyset}
        """,
        [*params, *keyset_params],
    )
    total = await fetch_one(
        conn, f"SELECT count(*) AS n FROM project p WHERE {clause}", params
    )
    items, next_cursor = build_page(rows, req)
    return items, next_cursor, int((total or {}).get("n", 0))


# ------------------------------------------------------- facts for the machine
async def facts(conn: Conn, project_id: int) -> dict[str, Any]:
    """One query for everything the state machine needs to decide.

    Assembled here rather than in the service so a transition cannot be decided
    against facts read at three different moments.
    """
    row = await fetch_one(
        conn,
        """
        SELECT
          p.project_status,
          p.dco_user_id IS NOT NULL                       AS has_dco,
          coalesce(length(trim(p.description)), 0) > 0    AS has_description,
          n.notice_id IS NOT NULL                         AS has_notice,
          coalesce(np.purpose_count, 0)                   AS notice_purpose_count,
          coalesce(n.status = 'published', false)         AS notice_published,
          (n.notice_id IS NOT NULL
             AND coalesce(length(trim(n.withdraw_url)), 0) > 0
             AND coalesce(length(trim(n.exercise_rights_url)), 0) > 0
             AND coalesce(length(trim(n.board_complaint_url)), 0) > 0
             AND coalesce(length(trim(n.dpo_contact)), 0) > 0
             AND coalesce(np.purpose_count, 0) >= 1
             AND coalesce(nl.approved_languages, 0) >= 1) AS notice_rule3_complete,
          coalesce(ap.proof_count, 0)                     AS approval_with_proof_count
        FROM project p
        LEFT JOIN notice n ON n.notice_id = p.current_notice_id
        LEFT JOIN LATERAL (
          SELECT count(*) AS purpose_count FROM notice_purpose x WHERE x.notice_id = n.notice_id
        ) np ON TRUE
        LEFT JOIN LATERAL (
          SELECT count(*) AS approved_languages FROM notice_language y
          WHERE y.notice_id = n.notice_id AND y.approved_at IS NOT NULL
        ) nl ON TRUE
        LEFT JOIN LATERAL (
          SELECT count(*) AS proof_count FROM project_approval z
          WHERE z.project_id = p.project_id
            AND coalesce(length(trim(z.proof_file_ref)), 0) > 0
            AND coalesce(length(trim(z.proof_file_hash)), 0) > 0
        ) ap ON TRUE
        WHERE p.project_id = %s
        """,
        (project_id,),
    )
    return row or {}


async def summary(conn: Conn, project_id: int) -> dict[str, Any]:
    """The counts a dashboard needs, in one call rather than six."""
    row = await fetch_one(
        conn,
        """
        SELECT
          (SELECT count(*) FROM notice       WHERE project_id = p.project_id) AS notices,
          (SELECT count(*) FROM project_site WHERE project_id = p.project_id
                                               AND status = 'active')          AS sites,
          (SELECT count(*) FROM project_approval WHERE project_id = p.project_id) AS approvals,
          (SELECT count(DISTINCT np.purpose_id)
             FROM notice n2 JOIN notice_purpose np ON np.notice_id = n2.notice_id
            WHERE n2.project_id = p.project_id)                                AS purposes,
          (SELECT count(*) FROM consent_link cl
             JOIN notice n3 ON n3.notice_id = cl.notice_id
            WHERE n3.project_id = p.project_id AND cl.status = 'active')       AS active_links,
          (SELECT count(*) FROM export_log   WHERE project_id = p.project_id)  AS exports,
          (SELECT count(*) FROM collection   WHERE project_id = p.project_id)  AS collections
        FROM project p WHERE p.project_id = %s
        """,
        (project_id,),
    )
    return row or {}


async def consent_counts(conn: Conn, project_id: int) -> dict[str, int]:
    """Consent totals for a project, derived from the current-consent view.

    Never from a stored status column: a denormalised status is a second copy of
    the truth, and the copy is what goes stale.
    """
    row = await fetch_one(
        conn,
        """
        WITH current AS (
          SELECT vc.consent_id, vc.is_withdrawal
          FROM v_current_consent vc
          JOIN notice n ON n.notice_id = vc.notice_id
          WHERE n.project_id = %s
        ), graded AS (
          SELECT c.consent_id,
                 c.is_withdrawal,
                 count(*) FILTER (WHERE g.granted)     AS granted_count,
                 count(*) FILTER (WHERE NOT g.granted) AS refused_count
          FROM current c
          LEFT JOIN consent_purpose_grant g ON g.consent_id = c.consent_id
          GROUP BY c.consent_id, c.is_withdrawal
        )
        SELECT
          count(*)                                                          AS total,
          count(*) FILTER (WHERE is_withdrawal)                             AS withdrawn,
          count(*) FILTER (WHERE NOT is_withdrawal AND granted_count > 0
                                 AND refused_count = 0)                     AS consented,
          count(*) FILTER (WHERE NOT is_withdrawal AND granted_count > 0
                                 AND refused_count > 0)                     AS partial,
          count(*) FILTER (WHERE NOT is_withdrawal AND granted_count = 0)   AS declined
        FROM graded
        """,
        (project_id,),
    )
    return {k: int(v or 0) for k, v in (row or {}).items()}


# ---------------------------------------------------------------- approvals
async def add_approval(
    conn: Conn,
    *,
    project_id: int,
    approval_type: str,
    reference_no: str,
    approved_on: Any,
    proof_file_ref: str,
    proof_file_hash: str,
    uploaded_by: int,
) -> Row:
    row = await fetch_one(
        conn,
        """
        INSERT INTO project_approval (project_id, approval_type, reference_no, approved_on,
                                      proof_file_ref, proof_file_hash, uploaded_by)
        VALUES (%s, %s::approval_type, %s, %s, %s, %s, %s)
        RETURNING approval_id, approval_uuid, approval_type, reference_no,
                  approved_on, proof_file_hash, uploaded_at
        """,
        (project_id, approval_type, reference_no, approved_on, proof_file_ref,
         proof_file_hash, uploaded_by),
    )
    assert row is not None
    return row


async def list_approvals(conn: Conn, project_id: int) -> list[Row]:
    return await fetch_all(
        conn,
        """
        SELECT a.approval_uuid, a.approval_type, a.reference_no, a.approved_on,
               a.proof_file_hash, a.uploaded_at,
               u.uuid AS uploaded_by_uuid, u.full_name AS uploaded_by_name
        FROM project_approval a
        JOIN auth_user u ON u.id = a.uploaded_by
        WHERE a.project_id = %s
        ORDER BY a.uploaded_at DESC
        """,
        (project_id,),
    )


async def approval_by_uuid(
    conn: Conn, approval_uuid: str, *, role: Role | str, user_id: int
) -> Row | None:
    pred, params = _scope_predicate(role, user_id)
    return await fetch_one(
        conn,
        f"""
        SELECT a.approval_id, a.approval_uuid, a.approval_type, a.reference_no,
               a.approved_on, a.proof_file_ref, a.proof_file_hash, a.uploaded_at,
               p.project_uuid, p.project_id,
               u.uuid AS uploaded_by_uuid, u.full_name AS uploaded_by_name
        FROM project_approval a
        JOIN project p ON p.project_id = a.project_id
        JOIN auth_user u ON u.id = a.uploaded_by
        WHERE a.approval_uuid = %s AND ({pred})
        """,
        [approval_uuid, *params],
    )


# -------------------------------------------------------------------- sites
async def add_site(
    conn: Conn,
    *,
    project_id: int,
    site_label: str,
    location: str | None,
    processor_id: int | None,
) -> Row:
    row = await fetch_one(
        conn,
        """
        INSERT INTO project_site (project_id, site_label, location, processor_id)
        VALUES (%s, %s, %s, %s)
        RETURNING site_id, site_uuid, site_label, location, status, created_at
        """,
        (project_id, site_label, location, processor_id),
    )
    assert row is not None
    return row


async def list_sites(conn: Conn, project_id: int) -> list[Row]:
    return await fetch_all(
        conn,
        """
        SELECT s.site_uuid, s.site_label, s.location, s.status, s.created_at,
               pr.processor_uuid, pr.legal_name AS processor_name,
               (SELECT count(*) FROM consent_link cl
                 WHERE cl.site_id = s.site_id AND cl.status = 'active') AS active_links
        FROM project_site s
        LEFT JOIN processor pr ON pr.processor_id = s.processor_id
        WHERE s.project_id = %s
        ORDER BY s.created_at
        """,
        (project_id,),
    )


async def site_by_uuid(
    conn: Conn, site_uuid: str, *, role: Role | str, user_id: int
) -> Row | None:
    pred, params = _scope_predicate(role, user_id)
    return await fetch_one(
        conn,
        f"""
        SELECT s.site_id, s.site_uuid, s.site_label, s.location, s.status, s.created_at,
               p.project_id, p.project_uuid, p.project_status,
               pr.processor_uuid, pr.legal_name AS processor_name
        FROM project_site s
        JOIN project p ON p.project_id = s.project_id
        LEFT JOIN processor pr ON pr.processor_id = s.processor_id
        WHERE s.site_uuid = %s AND ({pred})
        """,
        [site_uuid, *params],
    )


async def update_site(
    conn: Conn, site_id: int, *, site_label: str | None, location: str | None
) -> Row:
    row = await fetch_one(
        conn,
        """
        UPDATE project_site
           SET site_label = COALESCE(%s, site_label),
               location   = COALESCE(%s, location)
         WHERE site_id = %s
        RETURNING site_uuid, site_label, location, status
        """,
        (site_label, location, site_id),
    )
    assert row is not None
    return row


async def deactivate_site(conn: Conn, site_id: int) -> None:
    await conn.execute(
        "UPDATE project_site SET status = 'terminated' WHERE site_id = %s", (site_id,)
    )


# ---------------------------------------------------- cross-project listing
SITE_SORTS = ("created_at", "site_label")
APPROVAL_SORTS = ("uploaded_at", "approved_on")


async def list_all_sites(
    conn: Conn,
    req: PageRequest,
    *,
    role: Role | str,
    user_id: int,
    status: str | None = None,
) -> tuple[list[Row], str | None, int]:
    """Every collection site this caller may see, across projects."""
    pred, sparams = _scope_predicate(role, user_id)
    where = [pred]
    params: list[Any] = [*sparams]

    if status:
        where.append("st.status = %s::record_status")
        params.append(status)

    clause = " AND ".join(where)
    keyset, kparams = keyset_clause(req, alias="st", id_column="site_id")
    base = """
        FROM project_site st
        JOIN project p ON p.project_id = st.project_id
        LEFT JOIN processor pr ON pr.processor_id = st.processor_id
    """
    rows = await fetch_all(
        conn,
        f"""SELECT st.site_id AS _row_id, st.site_uuid, st.site_label, st.location,
            st.status, st.created_at,
            p.project_uuid, p.project_name, p.project_status,
            pr.processor_uuid, pr.legal_name AS processor_name,
            (SELECT count(*) FROM consent_link cl
              WHERE cl.site_id = st.site_id AND cl.status = 'active') AS active_links
            {base} WHERE {clause}{keyset}""",
        [*params, *kparams],
    )
    total = await fetch_one(conn, f"SELECT count(*) AS n {base} WHERE {clause}", params)
    items, cursor = build_page(rows, req)
    return items, cursor, int((total or {}).get("n", 0))


async def list_all_approvals(
    conn: Conn, req: PageRequest, *, role: Role | str, user_id: int
) -> tuple[list[Row], str | None, int]:
    """Every approval this caller may see, across projects.

    INV-8: an approval without a proof file does not unlock the transition, so
    the proof hash travels with the row rather than requiring a second call.
    """
    pred, sparams = _scope_predicate(role, user_id)
    keyset, kparams = keyset_clause(req, alias="a", id_column="approval_id")
    base = """
        FROM project_approval a
        JOIN project p   ON p.project_id = a.project_id
        JOIN auth_user u ON u.id = a.uploaded_by
    """
    rows = await fetch_all(
        conn,
        f"""SELECT a.approval_id AS _row_id, a.approval_uuid, a.approval_type,
            a.reference_no, a.approved_on, a.proof_file_hash, a.uploaded_at,
            p.project_uuid, p.project_name, p.project_status,
            u.uuid AS uploaded_by_uuid, u.full_name AS uploaded_by_name
            {base} WHERE {pred}{keyset}""",
        [*sparams, *kparams],
    )
    total = await fetch_one(conn, f"SELECT count(*) AS n {base} WHERE {pred}", sparams)
    items, cursor = build_page(rows, req)
    return items, cursor, int((total or {}).get("n", 0))
