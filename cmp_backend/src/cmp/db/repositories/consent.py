"""consent_link, consent_artefact, consent_purpose_grant.

Everything here is append-only. Withdrawal is a *new* artefact that supersedes
the old one; nothing is ever edited in place. `v_current_consent` resolves the
supersession chain, and every read of "what does she currently allow" goes
through it - never through a stored status column, which would be a second copy
of the truth that goes stale.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from cmp.core.pagination import PageRequest, build_page
from cmp.core.permissions import Role, Scope, scope_of
from cmp.db.sql import Conn, Row, fetch_all, fetch_one, keyset_clause


def _project_scope(role: Role | str, user_id: int) -> tuple[str, list[Any]]:
    """Which consents and links this caller may see.

    Scoped to the **site** a consent was collected at, not to the project it
    belongs to. Those differ on any project with more than one collection owner,
    and keying on `p.dco_user_id` - the *primary* site's owner - was wrong in
    both directions at once: the owner of the primary site saw every consent on
    the project including ones taken at somebody else's campus, and the other
    owner saw none of their own.

    Every query behind this joins `project_site s` through the link, and
    `consent_artefact.link_id` is NOT NULL, so there is always a site to scope
    by. An R&D User still sees their whole project - they designed the study,
    and its consents are the thing it exists to produce.
    """
    match scope_of("consent", role):
        case Scope.ALL:
            return "TRUE", []
        case Scope.SCOPED:
            from cmp.db.repositories.projects import site_scope_predicate

            return site_scope_predicate(role, user_id, alias="s")
        case Scope.OWN:
            return "p.created_by = %s", [user_id]
        case _:
            return "FALSE", []


# ---------------------------------------------------------------------- links
async def create_link(
    conn: Conn,
    *,
    notice_id: int,
    site_id: int,
    token_stored: str,
    expires_at: datetime,
    max_uses: int | None,
    created_by: int,
) -> Row:
    row = await fetch_one(
        conn,
        """
        INSERT INTO consent_link (notice_id, site_id, token, expires_at, max_uses, created_by)
        VALUES (%s, %s, %s, %s, %s, %s)
        RETURNING link_id, link_uuid, expires_at, max_uses, use_count, status, created_at
        """,
        (notice_id, site_id, token_stored, expires_at, max_uses, created_by),
    )
    assert row is not None
    return row


async def link_by_token(conn: Conn, token_stored: str) -> Row | None:
    """Resolve a capability token to its link, notice and project.

    Everything needed to decide whether the link may be served is fetched in one
    query: a second round trip is a window in which the link could be revoked.
    """
    return await fetch_one(
        conn,
        """
        SELECT cl.link_id, cl.link_uuid, cl.notice_id, cl.site_id, cl.expires_at,
               cl.max_uses, cl.use_count, cl.status,
               n.notice_uuid, n.status AS notice_status, n.notice_code, n.version,
               n.withdraw_url, n.exercise_rights_url, n.board_complaint_url, n.dpo_contact,
               n.recipients_text,
               p.project_id, p.project_uuid, p.project_name, p.project_status,
               s.site_uuid, s.site_label, s.status AS site_status
        FROM consent_link cl
        JOIN notice n       ON n.notice_id = cl.notice_id
        JOIN project p      ON p.project_id = n.project_id
        JOIN project_site s ON s.site_id = cl.site_id
        WHERE cl.token = %s
        """,
        (token_stored,),
    )


async def link_by_uuid(conn: Conn, link_uuid: str, *, role: Role | str, user_id: int) -> Row | None:
    pred, params = _project_scope(role, user_id)
    return await fetch_one(
        conn,
        f"""
        SELECT cl.link_id, cl.link_uuid, cl.expires_at, cl.max_uses, cl.use_count,
               cl.status, cl.created_at, cl.revoked_at,
               n.notice_uuid, n.notice_code, n.version,
               p.project_uuid, p.project_name,
               s.site_uuid, s.site_label
        FROM consent_link cl
        JOIN notice n       ON n.notice_id = cl.notice_id
        JOIN project p      ON p.project_id = n.project_id
        JOIN project_site s ON s.site_id = cl.site_id
        WHERE cl.link_uuid = %s AND ({pred})
        """,
        [link_uuid, *params],
    )


async def increment_use(conn: Conn, link_id: int) -> Row | None:
    """Consume one use, atomically, refusing to exceed the cap.

    The predicate is in the UPDATE rather than a read-then-write, so two
    simultaneous registrations cannot both pass a check that only one of them
    should have.
    """
    return await fetch_one(
        conn,
        """
        UPDATE consent_link
           SET use_count = use_count + 1
         WHERE link_id = %s
           AND status = 'active'
           AND expires_at > now()
           AND (max_uses IS NULL OR use_count < max_uses)
        RETURNING link_id, use_count, max_uses
        """,
        (link_id,),
    )


async def revoke_link(conn: Conn, link_id: int, actor_id: int) -> Row | None:
    return await fetch_one(
        conn,
        """
        UPDATE consent_link SET status = 'revoked', revoked_by = %s, revoked_at = now()
         WHERE link_id = %s AND status = 'active'
        RETURNING link_uuid, status, revoked_at
        """,
        (actor_id, link_id),
    )


async def revoke_links_for_project(conn: Conn, *, project_uuid: str, actor_id: int) -> int:
    cur = await conn.execute(
        """
        UPDATE consent_link cl
           SET status = 'revoked', revoked_by = %s, revoked_at = now()
          FROM notice n, project p
         WHERE cl.notice_id = n.notice_id
           AND n.project_id = p.project_id
           AND p.project_uuid = %s
           AND cl.status = 'active'
        """,
        (actor_id, project_uuid),
    )
    return cur.rowcount


async def expire_due_links(conn: Conn) -> int:
    """Scheduled sweep. Idempotent: rows already expired are not matched."""
    cur = await conn.execute(
        "UPDATE consent_link SET status = 'expired' WHERE status = 'active' AND expires_at <= now()"
    )
    return cur.rowcount


async def links_for_project(conn: Conn, project_id: int) -> list[Row]:
    return await fetch_all(
        conn,
        """
        SELECT cl.link_uuid, cl.expires_at, cl.max_uses, cl.use_count, cl.status,
               cl.created_at, cl.revoked_at,
               s.site_uuid, s.site_label,
               n.notice_uuid, n.notice_code, n.version
        FROM consent_link cl
        JOIN notice n       ON n.notice_id = cl.notice_id
        JOIN project_site s ON s.site_id = cl.site_id
        WHERE n.project_id = %s
        ORDER BY cl.created_at DESC
        """,
        (project_id,),
    )


async def link_stats(conn: Conn, link_id: int) -> dict[str, Any]:
    row = await fetch_one(
        conn,
        """
        SELECT
          cl.use_count,
          cl.max_uses,
          CASE WHEN cl.max_uses IS NULL THEN NULL
               ELSE greatest(0, cl.max_uses - cl.use_count) END          AS uses_remaining,
          (SELECT count(*) FROM auth_user u
            WHERE u.registered_via_link_id = cl.link_id)                 AS registrations,
          (SELECT count(*) FROM consent_artefact ca
            WHERE ca.link_id = cl.link_id AND NOT ca.is_withdrawal)      AS consents,
          (SELECT count(*) FROM consent_artefact ca
            WHERE ca.link_id = cl.link_id AND ca.is_withdrawal)          AS withdrawals,
          (SELECT count(*) FROM consent_artefact ca
             JOIN v_current_consent v ON v.consent_id = ca.consent_id
            WHERE ca.link_id = cl.link_id
              AND NOT EXISTS (SELECT 1 FROM consent_purpose_grant g
                               WHERE g.consent_id = ca.consent_id AND g.granted)) AS declines
        FROM consent_link cl WHERE cl.link_id = %s
        """,
        (link_id,),
    )
    return row or {}


# ------------------------------------------------------------------ artefacts
ARTEFACT_COLUMNS = """
  ca.consent_uuid, ca.notice_content_hash, ca.served_at, ca.affirmative_action_at,
  ca.action_type, ca.is_withdrawal, ca.created_at
"""


async def create_artefact(
    conn: Conn,
    *,
    auth_user_id: int,
    notice_id: int,
    notice_language_id: int,
    notice_content_hash: str,
    link_id: int,
    served_at: datetime,
    affirmative_action_at: datetime,
    action_type: str,
    ip_address: str | None,
    is_withdrawal: bool = False,
    supersedes_consent_id: int | None = None,
) -> Row:
    row = await fetch_one(
        conn,
        """
        INSERT INTO consent_artefact
          (auth_user_id, notice_id, notice_language_id, notice_content_hash, link_id,
           served_at, affirmative_action_at, action_type, ip_address, is_withdrawal,
           supersedes_consent_id)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s::action_type, %s::inet, %s, %s)
        RETURNING consent_id, consent_uuid, served_at, affirmative_action_at,
                  action_type, is_withdrawal, created_at
        """,
        (
            auth_user_id,
            notice_id,
            notice_language_id,
            notice_content_hash,
            link_id,
            served_at,
            affirmative_action_at,
            action_type,
            ip_address,
            is_withdrawal,
            supersedes_consent_id,
        ),
    )
    assert row is not None
    return row


async def add_grants(conn: Conn, consent_id: int, grants: dict[int, bool]) -> None:
    if not grants:
        return
    values = ", ".join(["(%s, %s, %s)"] * len(grants))
    params: list[Any] = []
    for purpose_id, granted in grants.items():
        params.extend([consent_id, purpose_id, granted])
    await conn.execute(
        f"INSERT INTO consent_purpose_grant (consent_id, purpose_id, granted) VALUES {values}",
        params,
    )


async def current_for_user_notice(conn: Conn, *, user_id: int, notice_id: int) -> Row | None:
    """The live artefact for one person and one notice, via the supersession chain."""
    return await fetch_one(
        conn,
        f"""
        SELECT ca.consent_id, ca.notice_id, ca.notice_language_id, ca.link_id,
               {ARTEFACT_COLUMNS}
        FROM v_current_consent ca
        WHERE ca.auth_user_id = %s AND ca.notice_id = %s
        ORDER BY ca.affirmative_action_at DESC
        LIMIT 1
        """,
        (user_id, notice_id),
    )


async def artefact_by_uuid(conn: Conn, consent_uuid: str) -> Row | None:
    return await fetch_one(
        conn,
        f"""
        SELECT ca.consent_id, ca.auth_user_id, ca.notice_id, ca.notice_language_id,
               ca.link_id, ca.supersedes_consent_id, {ARTEFACT_COLUMNS},
               n.notice_uuid, n.notice_code, n.version,
               nl.language_code,
               p.project_uuid, p.project_name, p.project_id,
               s.site_uuid, s.site_label,
               u.uuid AS subject_uuid, u.full_name AS subject_name,
               u.email AS subject_email, u.mobile AS subject_mobile
        FROM consent_artefact ca
        JOIN notice n          ON n.notice_id = ca.notice_id
        JOIN notice_language nl ON nl.notice_language_id = ca.notice_language_id
        JOIN project p         ON p.project_id = n.project_id
        JOIN consent_link cl   ON cl.link_id = ca.link_id
        JOIN project_site s    ON s.site_id = cl.site_id
        JOIN auth_user u       ON u.id = ca.auth_user_id
        WHERE ca.consent_uuid = %s
        """,
        (consent_uuid,),
    )


async def artefact_scoped(
    conn: Conn, consent_uuid: str, *, role: Role | str, user_id: int
) -> Row | None:
    pred, params = _project_scope(role, user_id)
    return await fetch_one(
        conn,
        f"""
        SELECT ca.consent_id, {ARTEFACT_COLUMNS},
               n.notice_uuid, n.notice_code, n.version, nl.language_code,
               p.project_uuid, p.project_name,
               s.site_uuid, s.site_label,
               u.uuid AS subject_uuid, u.full_name AS subject_name,
               u.email AS subject_email, u.mobile AS subject_mobile
        FROM consent_artefact ca
        JOIN notice n           ON n.notice_id = ca.notice_id
        JOIN notice_language nl ON nl.notice_language_id = ca.notice_language_id
        JOIN project p          ON p.project_id = n.project_id
        JOIN consent_link cl    ON cl.link_id = ca.link_id
        JOIN project_site s     ON s.site_id = cl.site_id
        JOIN auth_user u        ON u.id = ca.auth_user_id
        WHERE ca.consent_uuid = %s AND ({pred})
        """,
        [consent_uuid, *params],
    )


async def grants_of(conn: Conn, consent_id: int) -> list[Row]:
    return await fetch_all(
        conn,
        """
        SELECT p.purpose_uuid, p.purpose_code, p.name, p.description, p.uses,
               p.lawful_basis, p.data_categories, p.retention_period,
               g.granted
        FROM consent_purpose_grant g
        JOIN purpose p ON p.purpose_id = g.purpose_id
        WHERE g.consent_id = %s
        ORDER BY p.name
        """,
        (consent_id,),
    )


async def history_chain(conn: Conn, *, user_id: int, notice_id: int) -> list[Row]:
    """Every grant and withdrawal in order, so she can see the whole story."""
    return await fetch_all(
        conn,
        f"""
        SELECT ca.consent_id, ca.supersedes_consent_id, {ARTEFACT_COLUMNS},
               nl.language_code,
               (SELECT count(*) FROM consent_purpose_grant g
                 WHERE g.consent_id = ca.consent_id AND g.granted) AS granted_count,
               (SELECT count(*) FROM consent_purpose_grant g
                 WHERE g.consent_id = ca.consent_id) AS purpose_count
        FROM consent_artefact ca
        JOIN notice_language nl ON nl.notice_language_id = ca.notice_language_id
        WHERE ca.auth_user_id = %s AND ca.notice_id = %s
        ORDER BY ca.affirmative_action_at ASC, ca.consent_id ASC
        """,
        (user_id, notice_id),
    )


LIST_SORTS = ("affirmative_action_at", "created_at")


async def list_for_project(
    conn: Conn,
    req: PageRequest,
    *,
    project_id: int,
    site_uuid: str | None = None,
    status: str | None = None,
    date_from: datetime | None = None,
    date_to: datetime | None = None,
) -> tuple[list[Row], str | None, int]:
    """Staff view of consents.

    Contact details and consent status only - staff see no other personal data.
    Status is derived from the grants, never stored.
    """
    where = ["n.project_id = %s"]
    params: list[Any] = [project_id]

    if site_uuid:
        where.append("s.site_uuid = %s")
        params.append(site_uuid)
    if date_from:
        where.append("ca.affirmative_action_at >= %s")
        params.append(date_from)
    if date_to:
        where.append("ca.affirmative_action_at <= %s")
        params.append(date_to)

    status_sql = {
        "withdrawn": "ca.is_withdrawal",
        "consented": "NOT ca.is_withdrawal AND gr.granted_count > 0 AND gr.refused_count = 0",
        "partial": "NOT ca.is_withdrawal AND gr.granted_count > 0 AND gr.refused_count > 0",
        "declined": "NOT ca.is_withdrawal AND gr.granted_count = 0",
    }
    if status:
        if status not in status_sql:
            from cmp.core.errors import UnknownFilter

            raise UnknownFilter(
                f"Unknown status '{status}'",
                field="status",
                details={"allowed": sorted(status_sql)},
            )
        where.append(status_sql[status])

    clause = " AND ".join(where)
    keyset, kparams = keyset_clause(req, alias="ca", id_column="consent_id")

    base_from = """
        FROM v_current_consent ca
        JOIN notice n        ON n.notice_id = ca.notice_id
        JOIN consent_link cl ON cl.link_id = ca.link_id
        JOIN project_site s  ON s.site_id = cl.site_id
        JOIN auth_user u     ON u.id = ca.auth_user_id
        JOIN LATERAL (
          SELECT count(*) FILTER (WHERE g.granted)     AS granted_count,
                 count(*) FILTER (WHERE NOT g.granted) AS refused_count
          FROM consent_purpose_grant g WHERE g.consent_id = ca.consent_id
        ) gr ON TRUE
    """

    rows = await fetch_all(
        conn,
        f"""
        SELECT ca.consent_id AS _row_id, ca.consent_uuid, ca.affirmative_action_at,
               ca.served_at, ca.action_type, ca.is_withdrawal, ca.created_at,
               u.uuid AS subject_uuid, u.full_name AS subject_name,
               u.email AS subject_email, u.mobile AS subject_mobile,
               s.site_uuid, s.site_label,
               gr.granted_count, gr.refused_count,
               CASE WHEN ca.is_withdrawal THEN 'withdrawn'
                    WHEN gr.granted_count = 0 THEN 'declined'
                    WHEN gr.refused_count > 0 THEN 'partial'
                    ELSE 'consented' END AS consent_status
        {base_from}
        WHERE {clause}{keyset}
        """,
        [*params, *kparams],
    )
    total = await fetch_one(conn, f"SELECT count(*) AS n {base_from} WHERE {clause}", params)
    items, cursor = build_page(rows, req)
    return items, cursor, int((total or {}).get("n", 0))


async def consents_of_user(conn: Conn, user_id: int) -> list[Row]:
    return await fetch_all(
        conn,
        f"""
        SELECT ca.consent_id, {ARTEFACT_COLUMNS},
               n.notice_uuid, n.notice_code, n.version, nl.language_code,
               p.project_uuid, p.project_name,
               (SELECT count(*) FROM consent_purpose_grant g
                 WHERE g.consent_id = ca.consent_id AND g.granted) AS granted_count,
               (SELECT count(*) FROM consent_purpose_grant g
                 WHERE g.consent_id = ca.consent_id) AS purpose_count
        FROM v_current_consent ca
        JOIN notice n           ON n.notice_id = ca.notice_id
        JOIN notice_language nl ON nl.notice_language_id = ca.notice_language_id
        JOIN project p          ON p.project_id = n.project_id
        WHERE ca.auth_user_id = %s
        ORDER BY ca.affirmative_action_at DESC
        """,
        (user_id,),
    )


async def served_notice_text(conn: Conn, consent_id: int) -> Row | None:
    """The text she actually saw, matched on the copied hash.

    This must not join live to `notice_language` on notice + language alone: a
    later correction would silently repoint her record at words she never saw.
    The join is on the hash the artefact copied at capture (INV-4).
    """
    return await fetch_one(
        conn,
        """
        SELECT ca.consent_uuid, ca.notice_content_hash, ca.served_at,
               nl.language_code, nl.rendered_text, nl.content_hash,
               (nl.content_hash = ca.notice_content_hash) AS hash_matches,
               n.notice_uuid, n.notice_code, n.version, n.withdraw_url,
               n.exercise_rights_url, n.board_complaint_url, n.dpo_contact,
               n.recipients_text
        FROM consent_artefact ca
        JOIN notice_language nl ON nl.notice_language_id = ca.notice_language_id
        JOIN notice n           ON n.notice_id = ca.notice_id
        WHERE ca.consent_id = %s
        """,
        (consent_id,),
    )


async def assets_for_consent(conn: Conn, consent_id: int) -> list[Row]:
    """Which collected assets contain this person.

    The query an erasure request depends on, and the reason asset_consent exists.
    """
    return await fetch_all(
        conn,
        """
        SELECT da.asset_uuid, da.asset_type, da.source_asset_ref, da.storage_ref,
               da.has_unmapped_subjects, da.created_at,
               ac.subject_role, ac.disposition, ac.disposition_at,
               c.collection_uuid, c.collected_on,
               ds.source_code, ds.name AS source_name,
               p.project_uuid, p.project_name
        FROM asset_consent ac
        JOIN data_asset da ON da.asset_id = ac.asset_id
        JOIN collection c  ON c.collection_id = da.collection_id
        JOIN data_source ds ON ds.source_id = da.source_id
        JOIN project p     ON p.project_id = c.project_id
        WHERE ac.consent_id = %s
        ORDER BY c.collected_on DESC
        """,
        (consent_id,),
    )


# ---------------------------------------------------- cross-project listing
LINK_SORTS = ("created_at", "expires_at")


async def list_all_links(
    conn: Conn,
    req: PageRequest,
    *,
    role: Role | str,
    user_id: int,
    status: str | None = None,
) -> tuple[list[Row], str | None, int]:
    """Every consent link this caller may see, across projects."""
    pred, sparams = _project_scope(role, user_id)
    where = [pred]
    params: list[Any] = [*sparams]

    if status:
        where.append("cl.status = %s::link_status")
        params.append(status)

    clause = " AND ".join(where)
    keyset, kparams = keyset_clause(req, alias="cl", id_column="link_id")
    base = """
        FROM consent_link cl
        JOIN notice n       ON n.notice_id = cl.notice_id
        JOIN project p      ON p.project_id = n.project_id
        JOIN project_site s ON s.site_id = cl.site_id
    """
    rows = await fetch_all(
        conn,
        f"""SELECT cl.link_id AS _row_id, cl.link_uuid, cl.expires_at, cl.max_uses,
            cl.use_count, cl.status, cl.created_at, cl.revoked_at,
            n.notice_uuid, n.notice_code, n.version,
            p.project_uuid, p.project_name,
            s.site_uuid, s.site_label,
            (SELECT count(*) FROM auth_user u WHERE u.registered_via_link_id = cl.link_id)
              AS registrations
            {base} WHERE {clause}{keyset}""",
        [*params, *kparams],
    )
    total = await fetch_one(conn, f"SELECT count(*) AS n {base} WHERE {clause}", params)
    items, cursor = build_page(rows, req)
    return items, cursor, int((total or {}).get("n", 0))


async def list_all_consents(
    conn: Conn,
    req: PageRequest,
    *,
    role: Role | str,
    user_id: int,
    status: str | None = None,
    project_uuid: str | None = None,
) -> tuple[list[Row], str | None, int]:
    """Every current consent this caller may see, across projects.

    Derived from v_current_consent, like every other consent read - a stored
    status column would be a second copy of the truth, and the copy goes stale.
    """
    pred, sparams = _project_scope(role, user_id)
    where = [pred]
    params: list[Any] = [*sparams]

    if project_uuid:
        where.append("p.project_uuid = %s")
        params.append(project_uuid)

    status_sql = {
        "withdrawn": "ca.is_withdrawal",
        "consented": "NOT ca.is_withdrawal AND gr.granted_count > 0 AND gr.refused_count = 0",
        "partial": "NOT ca.is_withdrawal AND gr.granted_count > 0 AND gr.refused_count > 0",
        "declined": "NOT ca.is_withdrawal AND gr.granted_count = 0",
    }
    if status:
        if status not in status_sql:
            from cmp.core.errors import UnknownFilter

            raise UnknownFilter(
                f"Unknown status {status!r}",
                field="status",
                details={"allowed": sorted(status_sql)},
            )
        where.append(status_sql[status])

    clause = " AND ".join(where)
    keyset, kparams = keyset_clause(req, alias="ca", id_column="consent_id")
    base = """
        FROM v_current_consent ca
        JOIN notice n        ON n.notice_id = ca.notice_id
        JOIN project p       ON p.project_id = n.project_id
        JOIN consent_link cl ON cl.link_id = ca.link_id
        JOIN project_site s  ON s.site_id = cl.site_id
        JOIN auth_user u     ON u.id = ca.auth_user_id
        JOIN LATERAL (
          SELECT count(*) FILTER (WHERE g.granted)     AS granted_count,
                 count(*) FILTER (WHERE NOT g.granted) AS refused_count
          FROM consent_purpose_grant g WHERE g.consent_id = ca.consent_id
        ) gr ON TRUE
    """
    rows = await fetch_all(
        conn,
        f"""SELECT ca.consent_id AS _row_id, ca.consent_uuid, ca.affirmative_action_at,
            ca.served_at, ca.action_type, ca.is_withdrawal,
            u.uuid AS subject_uuid, u.full_name AS subject_name,
            u.email AS subject_email, u.mobile AS subject_mobile,
            p.project_uuid, p.project_name, s.site_uuid, s.site_label,
            gr.granted_count, gr.refused_count,
            CASE WHEN ca.is_withdrawal THEN 'withdrawn'
                 WHEN gr.granted_count = 0 THEN 'declined'
                 WHEN gr.refused_count > 0 THEN 'partial'
                 ELSE 'consented' END AS consent_status
            {base} WHERE {clause}{keyset}""",
        [*params, *kparams],
    )
    total = await fetch_one(conn, f"SELECT count(*) AS n {base} WHERE {clause}", params)
    items, cursor = build_page(rows, req)
    return items, cursor, int((total or {}).get("n", 0))
