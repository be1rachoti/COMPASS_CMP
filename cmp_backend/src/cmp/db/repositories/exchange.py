"""export_log, export_line, import_batch, collection, data_asset, asset_consent.

`export_line` is three columns and it is what makes s.11(1)(b) answerable -
"who was my data shared with?" Without it the platform records *that* a
disclosure happened but not *to whom it related*, and answering means parsing
historical CSVs that may not have been retained.

Import is idempotent by construction: collections and assets upsert on
(source, source_reference). Re-submitting the same file accepts nothing and
reports zero, which is what makes at-least-once delivery safe.
"""

from __future__ import annotations

from datetime import date
from typing import Any

from cmp.core.pagination import PageRequest, build_page
from cmp.core.permissions import Role, Scope, scope_of
from cmp.db.sql import Conn, Row, fetch_all, fetch_one, keyset_clause


def _scope(resource: str, role: Role | str, user_id: int) -> tuple[str, list[Any]]:
    match scope_of(resource, role):
        case Scope.ALL:
            return "TRUE", []
        case Scope.SCOPED:
            return "p.dco_user_id = %s", [user_id]
        case Scope.OWN:
            return "p.created_by = %s", [user_id]
        case _:
            return "FALSE", []


# ------------------------------------------------------------------- exports
async def create_export(
    conn: Conn,
    *,
    project_id: int,
    site_id: int,
    export_type: str,
    exported_by: int,
    row_count: int,
    file_hash: str,
) -> Row:
    row = await fetch_one(
        conn,
        """
        INSERT INTO export_log (project_id, site_id, export_type, exported_by,
                                row_count, file_hash)
        VALUES (%s, %s, %s::export_type, %s, %s, %s)
        RETURNING export_id, export_uuid, export_type, exported_at, row_count, file_hash
        """,
        (project_id, site_id, export_type, exported_by, row_count, file_hash),
    )
    assert row is not None
    return row


async def add_export_lines(conn: Conn, export_id: int, pairs: list[tuple[int, int]]) -> int:
    """One row per subject in the file. This is the disclosure record."""
    if not pairs:
        return 0
    values = ", ".join(["(%s, %s, %s)"] * len(pairs))
    params: list[Any] = []
    for user_id, consent_id in pairs:
        params.extend([export_id, user_id, consent_id])
    cur = await conn.execute(
        f"INSERT INTO export_line (export_id, auth_user_id, consent_id) VALUES {values}",
        params,
    )
    return cur.rowcount


async def export_by_uuid(
    conn: Conn, export_uuid: str, *, role: Role | str, user_id: int
) -> Row | None:
    pred, params = _scope("export", role, user_id)
    return await fetch_one(
        conn,
        f"""
        SELECT e.export_id, e.export_uuid, e.export_type, e.exported_at, e.row_count,
               e.file_hash, p.project_uuid, p.project_name, p.project_id,
               s.site_uuid, s.site_label,
               u.uuid AS exported_by_uuid, u.full_name AS exported_by_name
        FROM export_log e
        JOIN project p      ON p.project_id = e.project_id
        JOIN project_site s ON s.site_id = e.site_id
        JOIN auth_user u    ON u.id = e.exported_by
        WHERE e.export_uuid = %s AND ({pred})
        """,
        [export_uuid, *params],
    )


async def exports_for_project(conn: Conn, project_id: int) -> list[Row]:
    return await fetch_all(
        conn,
        """
        SELECT e.export_uuid, e.export_type, e.exported_at, e.row_count, e.file_hash,
               s.site_uuid, s.site_label,
               u.uuid AS exported_by_uuid, u.full_name AS exported_by_name
        FROM export_log e
        JOIN project_site s ON s.site_id = e.site_id
        JOIN auth_user u    ON u.id = e.exported_by
        WHERE e.project_id = %s
        ORDER BY e.exported_at DESC
        """,
        (project_id,),
    )


async def export_lines(conn: Conn, export_id: int) -> list[Row]:
    """Who was in a given file. Combined with the consent record it answers s.11(1)(b)."""
    return await fetch_all(
        conn,
        """
        SELECT u.uuid AS subject_uuid, u.full_name AS subject_name, u.email AS subject_email,
               ca.consent_uuid, ca.affirmative_action_at
        FROM export_line el
        JOIN auth_user u        ON u.id = el.auth_user_id
        JOIN consent_artefact ca ON ca.consent_id = el.consent_id
        WHERE el.export_id = %s
        ORDER BY u.full_name
        """,
        (export_id,),
    )


async def disclosures_for_user(conn: Conn, user_id: int) -> list[Row]:
    """ "Who was my data shared with?" - answered from the database, not an archive."""
    return await fetch_all(
        conn,
        """
        SELECT e.export_uuid, e.export_type, e.exported_at,
               p.project_uuid, p.project_name,
               s.site_uuid, s.site_label,
               pr.legal_name AS processor_name
        FROM export_line el
        JOIN export_log e   ON e.export_id = el.export_id
        JOIN project p      ON p.project_id = e.project_id
        JOIN project_site s ON s.site_id = e.site_id
        LEFT JOIN processor pr ON pr.processor_id = s.processor_id
        WHERE el.auth_user_id = %s
        ORDER BY e.exported_at DESC
        """,
        (user_id,),
    )


async def consented_subjects(conn: Conn, *, project_id: int, site_id: int) -> list[Row]:
    """Export B: only subjects whose current artefact grants at least one purpose."""
    return await fetch_all(
        conn,
        """
        SELECT u.id AS auth_user_id, u.uuid AS subject_uuid, u.full_name, u.email, u.mobile,
               u.organization_id, u.person_type,
               ca.consent_id, ca.consent_uuid, ca.affirmative_action_at,
               ca.notice_content_hash,
               n.notice_uuid, n.notice_code, n.version AS notice_version,
               array_agg(p.purpose_code ORDER BY p.purpose_code)
                 FILTER (WHERE g.granted) AS granted_purposes
        FROM v_current_consent ca
        JOIN notice n        ON n.notice_id = ca.notice_id
        JOIN consent_link cl ON cl.link_id = ca.link_id
        JOIN auth_user u     ON u.id = ca.auth_user_id
        JOIN consent_purpose_grant g ON g.consent_id = ca.consent_id
        JOIN purpose p       ON p.purpose_id = g.purpose_id
        WHERE n.project_id = %s
          AND cl.site_id = %s
          AND NOT ca.is_withdrawal
        GROUP BY u.id, u.uuid, u.full_name, u.email, u.mobile, u.organization_id,
                 u.person_type, ca.consent_id, ca.consent_uuid, ca.affirmative_action_at,
                 ca.notice_content_hash, n.notice_uuid, n.notice_code, n.version
        HAVING count(*) FILTER (WHERE g.granted) > 0
        ORDER BY u.full_name
        """,
        (project_id, site_id),
    )


# ------------------------------------------------------------------- imports
async def create_batch(
    conn: Conn,
    *,
    source_id: int,
    project_id: int | None,
    file_name: str,
    file_hash: str,
    declared_rows: int,
    imported_by: int,
) -> Row:
    row = await fetch_one(
        conn,
        """
        INSERT INTO import_batch (source_id, project_id, file_name, file_hash,
                                  declared_rows, imported_by, status)
        VALUES (%s, %s, %s, %s, %s, %s, 'validating')
        RETURNING batch_id, batch_uuid, file_name, file_hash, declared_rows, status, received_at
        """,
        (source_id, project_id, file_name, file_hash, declared_rows, imported_by),
    )
    assert row is not None
    return row


async def finish_batch(
    conn: Conn,
    batch_id: int,
    *,
    accepted: int,
    rejected: int,
    status: str,
    error_report: str | None,
) -> Row:
    row = await fetch_one(
        conn,
        """
        UPDATE import_batch
           SET accepted_rows = %s, rejected_rows = %s,
               status = %s::batch_status, error_report = %s
         WHERE batch_id = %s
        RETURNING batch_uuid, accepted_rows, rejected_rows, status, error_report, received_at
        """,
        (accepted, rejected, status, error_report, batch_id),
    )
    assert row is not None
    return row


async def batch_by_file_hash(conn: Conn, *, source_id: int, file_hash: str) -> Row | None:
    """Same file, same source, already accepted - the idempotency short-circuit."""
    return await fetch_one(
        conn,
        """SELECT batch_id, batch_uuid, status, accepted_rows, rejected_rows, received_at
           FROM import_batch
           WHERE source_id = %s AND file_hash = %s AND status IN ('accepted','partial')
           ORDER BY received_at DESC LIMIT 1""",
        (source_id, file_hash),
    )


async def batch_by_uuid(
    conn: Conn, batch_uuid: str, *, role: Role | str, user_id: int
) -> Row | None:
    pred, params = _scope("import", role, user_id)
    return await fetch_one(
        conn,
        f"""
        SELECT b.batch_id, b.batch_uuid, b.file_name, b.file_hash, b.declared_rows,
               b.accepted_rows, b.rejected_rows, b.status, b.error_report, b.received_at,
               ds.source_uuid, ds.source_code, ds.name AS source_name,
               p.project_uuid, p.project_name,
               u.uuid AS imported_by_uuid, u.full_name AS imported_by_name
        FROM import_batch b
        JOIN data_source ds ON ds.source_id = b.source_id
        LEFT JOIN project p ON p.project_id = b.project_id
        JOIN auth_user u    ON u.id = b.imported_by
        WHERE b.batch_uuid = %s AND (b.project_id IS NULL OR ({pred}))
        """,
        [batch_uuid, *params],
    )


BATCH_SORTS = ("received_at",)


async def list_batches(
    conn: Conn,
    req: PageRequest,
    *,
    role: Role | str,
    user_id: int,
    source_uuid: str | None = None,
    status: str | None = None,
) -> tuple[list[Row], str | None, int]:
    pred, sparams = _scope("import", role, user_id)
    where = [f"(b.project_id IS NULL OR ({pred}))"]
    params: list[Any] = [*sparams]

    if source_uuid:
        where.append("ds.source_uuid = %s")
        params.append(source_uuid)
    if status:
        where.append("b.status = %s::batch_status")
        params.append(status)

    clause = " AND ".join(where)
    keyset, kparams = keyset_clause(req, alias="b", id_column="batch_id")
    base = """
        FROM import_batch b
        JOIN data_source ds ON ds.source_id = b.source_id
        LEFT JOIN project p ON p.project_id = b.project_id
    """
    rows = await fetch_all(
        conn,
        f"""SELECT b.batch_id AS _row_id, b.batch_uuid, b.file_name, b.declared_rows,
            b.accepted_rows, b.rejected_rows, b.status, b.received_at,
            ds.source_uuid, ds.source_code, p.project_uuid, p.project_name
            {base} WHERE {clause}{keyset}""",
        [*params, *kparams],
    )
    total = await fetch_one(conn, f"SELECT count(*) AS n {base} WHERE {clause}", params)
    items, cursor = build_page(rows, req)
    return items, cursor, int((total or {}).get("n", 0))


# --------------------------------------------------- collections and assets
async def upsert_collection(
    conn: Conn,
    *,
    source_id: int,
    source_collection_ref: str,
    project_id: int,
    site_id: int | None,
    batch_id: int,
    agent_ref: str | None,
    collected_on: date,
    declared_asset_count: int,
) -> tuple[Row, bool]:
    """Idempotent on (source_id, source_collection_ref). Returns (row, created)."""
    row = await fetch_one(
        conn,
        """
        INSERT INTO collection (source_id, source_collection_ref, project_id, site_id,
                                batch_id, agent_ref, collected_on, declared_asset_count)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT (source_id, source_collection_ref) DO UPDATE
          SET declared_asset_count = EXCLUDED.declared_asset_count
        RETURNING collection_id, collection_uuid, source_collection_ref, collected_on,
                  declared_asset_count, created_at, (xmax = 0) AS created
        """,
        (
            source_id,
            source_collection_ref,
            project_id,
            site_id,
            batch_id,
            agent_ref,
            collected_on,
            declared_asset_count,
        ),
    )
    assert row is not None
    return row, bool(row.pop("created", False))


async def upsert_asset(
    conn: Conn,
    *,
    source_id: int,
    source_asset_ref: str,
    collection_id: int,
    asset_type: str,
    storage_ref: str | None,
    has_unmapped_subjects: bool,
) -> tuple[Row, bool]:
    row = await fetch_one(
        conn,
        """
        INSERT INTO data_asset (source_id, source_asset_ref, collection_id, asset_type,
                                storage_ref, has_unmapped_subjects)
        VALUES (%s, %s, %s, %s::asset_type, %s, %s)
        ON CONFLICT (source_id, source_asset_ref) DO UPDATE
          SET storage_ref           = EXCLUDED.storage_ref,
              has_unmapped_subjects = EXCLUDED.has_unmapped_subjects
        RETURNING asset_id, asset_uuid, source_asset_ref, asset_type, storage_ref,
                  has_unmapped_subjects, created_at, (xmax = 0) AS created
        """,
        (
            source_id,
            source_asset_ref,
            collection_id,
            asset_type,
            storage_ref,
            has_unmapped_subjects,
        ),
    )
    assert row is not None
    return row, bool(row.pop("created", False))


async def link_asset_subject(
    conn: Conn,
    *,
    asset_id: int,
    consent_id: int | None,
    subject_role: str,
    disposition: str | None = "active",
) -> Row:
    row = await fetch_one(
        conn,
        """
        INSERT INTO asset_consent (asset_id, consent_id, subject_role, disposition,
                                   disposition_at)
        VALUES (%s, %s, %s::subject_role, %s::disposition, now())
        RETURNING asset_consent_id, subject_role, disposition
        """,
        (asset_id, consent_id, subject_role, disposition),
    )
    assert row is not None
    return row


async def asset_subject_exists(conn: Conn, *, asset_id: int, consent_id: int | None) -> bool:
    row = await fetch_one(
        conn,
        """SELECT EXISTS (
             SELECT 1 FROM asset_consent
             WHERE asset_id = %s AND consent_id IS NOT DISTINCT FROM %s
           ) AS present""",
        (asset_id, consent_id),
    )
    return bool((row or {}).get("present"))


COLLECTION_SORTS = ("collected_on", "created_at")


async def list_collections(
    conn: Conn, req: PageRequest, *, project_id: int
) -> tuple[list[Row], str | None, int]:
    keyset, kparams = keyset_clause(req, alias="c", id_column="collection_id")
    rows = await fetch_all(
        conn,
        f"""
        SELECT c.collection_id AS _row_id, c.collection_uuid, c.source_collection_ref,
               c.collected_on, c.declared_asset_count, c.agent_ref, c.created_at,
               ds.source_uuid, ds.source_code, ds.name AS source_name,
               s.site_uuid, s.site_label,
               (SELECT count(*) FROM data_asset a WHERE a.collection_id = c.collection_id)
                 AS mapped_asset_count
        FROM collection c
        JOIN data_source ds ON ds.source_id = c.source_id
        LEFT JOIN project_site s ON s.site_id = c.site_id
        WHERE c.project_id = %s{keyset}
        """,
        [project_id, *kparams],
    )
    total = await fetch_one(
        conn, "SELECT count(*) AS n FROM collection c WHERE c.project_id = %s", (project_id,)
    )
    items, cursor = build_page(rows, req)
    return items, cursor, int((total or {}).get("n", 0))


async def collection_by_uuid(
    conn: Conn, collection_uuid: str, *, role: Role | str, user_id: int
) -> Row | None:
    pred, params = _scope("collection", role, user_id)
    return await fetch_one(
        conn,
        f"""
        SELECT c.collection_id, c.collection_uuid, c.source_collection_ref, c.collected_on,
               c.declared_asset_count, c.agent_ref, c.created_at,
               ds.source_uuid, ds.source_code, ds.name AS source_name,
               p.project_uuid, p.project_name,
               s.site_uuid, s.site_label,
               b.batch_uuid,
               (SELECT count(*) FROM data_asset a WHERE a.collection_id = c.collection_id)
                 AS mapped_asset_count
        FROM collection c
        JOIN data_source ds  ON ds.source_id = c.source_id
        JOIN project p       ON p.project_id = c.project_id
        JOIN import_batch b  ON b.batch_id = c.batch_id
        LEFT JOIN project_site s ON s.site_id = c.site_id
        WHERE c.collection_uuid = %s AND ({pred})
        """,
        [collection_uuid, *params],
    )


async def assets_of_collection(conn: Conn, collection_id: int) -> list[Row]:
    return await fetch_all(
        conn,
        """
        SELECT a.asset_uuid, a.source_asset_ref, a.asset_type, a.storage_ref,
               a.has_unmapped_subjects, a.created_at,
               (SELECT count(*) FROM asset_consent ac WHERE ac.asset_id = a.asset_id)
                 AS subject_count,
               (SELECT count(*) FROM asset_consent ac
                 WHERE ac.asset_id = a.asset_id AND ac.consent_id IS NULL) AS bystander_count
        FROM data_asset a
        WHERE a.collection_id = %s
        ORDER BY a.source_asset_ref
        """,
        (collection_id,),
    )


async def collection_exceptions(conn: Conn, collection_id: int) -> dict[str, Any]:
    """Declared against mapped, plus assets flagged as containing unmapped subjects.

    The failure mode this exists for is not a rejected file. It is 500 declared
    and 480 mapped, with 20 sitting in an unlawful state nobody sees.
    """
    counts = await fetch_one(
        conn,
        """
        SELECT c.declared_asset_count,
               (SELECT count(*) FROM data_asset a WHERE a.collection_id = c.collection_id)
                 AS mapped_asset_count,
               (SELECT count(*) FROM data_asset a
                 WHERE a.collection_id = c.collection_id AND a.has_unmapped_subjects)
                 AS flagged_asset_count,
               (SELECT count(*) FROM data_asset a
                  JOIN asset_consent ac ON ac.asset_id = a.asset_id
                 WHERE a.collection_id = c.collection_id AND ac.consent_id IS NULL)
                 AS bystander_rows
        FROM collection c WHERE c.collection_id = %s
        """,
        (collection_id,),
    )
    flagged = await fetch_all(
        conn,
        """
        SELECT a.asset_uuid, a.source_asset_ref, a.asset_type,
               (SELECT count(*) FROM asset_consent ac WHERE ac.asset_id = a.asset_id)
                 AS subject_count
        FROM data_asset a
        WHERE a.collection_id = %s AND a.has_unmapped_subjects
        ORDER BY a.source_asset_ref
        """,
        (collection_id,),
    )
    c = counts or {}
    declared = int(c.get("declared_asset_count") or 0)
    mapped = int(c.get("mapped_asset_count") or 0)
    return {
        "declared_asset_count": declared,
        "mapped_asset_count": mapped,
        "unaccounted": max(0, declared - mapped),
        "flagged_asset_count": int(c.get("flagged_asset_count") or 0),
        "bystander_rows": int(c.get("bystander_rows") or 0),
        "reconciled": declared == mapped and not flagged,
        "flagged_assets": flagged,
    }


async def asset_by_uuid(
    conn: Conn, asset_uuid: str, *, role: Role | str, user_id: int
) -> Row | None:
    pred, params = _scope("asset", role, user_id)
    return await fetch_one(
        conn,
        f"""
        SELECT a.asset_id, a.asset_uuid, a.source_asset_ref, a.asset_type, a.storage_ref,
               a.has_unmapped_subjects, a.created_at,
               c.collection_uuid, c.collected_on,
               ds.source_uuid, ds.source_code,
               p.project_uuid, p.project_name
        FROM data_asset a
        JOIN collection c   ON c.collection_id = a.collection_id
        JOIN data_source ds ON ds.source_id = a.source_id
        JOIN project p      ON p.project_id = c.project_id
        WHERE a.asset_uuid = %s AND ({pred})
        """,
        [asset_uuid, *params],
    )


async def asset_subjects(conn: Conn, asset_id: int) -> list[Row]:
    """One row per subject in the asset, including bystanders with a null consent id."""
    return await fetch_all(
        conn,
        """
        SELECT ac.subject_role, ac.disposition, ac.disposition_at, ac.created_at,
               ca.consent_uuid, u.uuid AS subject_uuid, u.full_name AS subject_name
        FROM asset_consent ac
        LEFT JOIN consent_artefact ca ON ca.consent_id = ac.consent_id
        LEFT JOIN auth_user u         ON u.id = ca.auth_user_id
        WHERE ac.asset_id = %s
        ORDER BY ac.subject_role, ac.asset_consent_id
        """,
        (asset_id,),
    )


# ---------------------------------------------------- cross-project listing
EXPORT_SORTS = ("exported_at",)


async def list_all_exports(
    conn: Conn,
    req: PageRequest,
    *,
    role: Role | str,
    user_id: int,
    export_type: str | None = None,
) -> tuple[list[Row], str | None, int]:
    """Every export this caller may see, across projects.

    This is the disclosure register: what left the platform, when, to which site,
    and how many people were in it.
    """
    pred, sparams = _scope("export", role, user_id)
    where = [pred]
    params: list[Any] = [*sparams]

    if export_type:
        where.append("e.export_type = %s::export_type")
        params.append(export_type)

    clause = " AND ".join(where)
    keyset, kparams = keyset_clause(req, alias="e", id_column="export_id")
    base = """
        FROM export_log e
        JOIN project p      ON p.project_id = e.project_id
        JOIN project_site s ON s.site_id = e.site_id
        JOIN auth_user u    ON u.id = e.exported_by
    """
    rows = await fetch_all(
        conn,
        f"""SELECT e.export_id AS _row_id, e.export_uuid, e.export_type, e.exported_at,
            e.row_count, e.file_hash,
            p.project_uuid, p.project_name, s.site_uuid, s.site_label,
            u.uuid AS exported_by_uuid, u.full_name AS exported_by_name,
            (SELECT count(*) FROM export_line el WHERE el.export_id = e.export_id)
              AS line_count
            {base} WHERE {clause}{keyset}""",
        [*params, *kparams],
    )
    total = await fetch_one(conn, f"SELECT count(*) AS n {base} WHERE {clause}", params)
    items, cursor = build_page(rows, req)
    return items, cursor, int((total or {}).get("n", 0))


async def list_all_collections(
    conn: Conn, req: PageRequest, *, role: Role | str, user_id: int
) -> tuple[list[Row], str | None, int]:
    """Every collection this caller may see, with its reconciliation gap.

    `unaccounted` is the number the DCO actually needs: declared minus mapped.
    Surfacing it in the list means nobody has to open each collection to find the
    one with twenty assets in an unlawful state.
    """
    pred, sparams = _scope("collection", role, user_id)
    keyset, kparams = keyset_clause(req, alias="c", id_column="collection_id")
    base = """
        FROM collection c
        JOIN project p      ON p.project_id = c.project_id
        JOIN data_source ds ON ds.source_id = c.source_id
        LEFT JOIN project_site s ON s.site_id = c.site_id
    """
    rows = await fetch_all(
        conn,
        f"""SELECT c.collection_id AS _row_id, c.collection_uuid, c.source_collection_ref,
            c.collected_on, c.declared_asset_count, c.agent_ref, c.created_at,
            ds.source_uuid, ds.source_code, ds.name AS source_name,
            p.project_uuid, p.project_name, s.site_uuid, s.site_label,
            (SELECT count(*) FROM data_asset a WHERE a.collection_id = c.collection_id)
              AS mapped_asset_count,
            greatest(0, c.declared_asset_count -
              (SELECT count(*) FROM data_asset a WHERE a.collection_id = c.collection_id))
              AS unaccounted
            {base} WHERE {pred}{keyset}""",
        [*sparams, *kparams],
    )
    total = await fetch_one(conn, f"SELECT count(*) AS n {base} WHERE {pred}", sparams)
    items, cursor = build_page(rows, req)
    return items, cursor, int((total or {}).get("n", 0))
