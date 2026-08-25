"""processor, data_source, purpose - the reference registry.

Registry rows are referenced by projects, notices and collections, so they are
suspended rather than deleted. A deleted processor orphans every collection that
named it, and the question "who processed this?" stops having an answer.
"""

from __future__ import annotations

from typing import Any

from cmp.core.pagination import PageRequest, build_page
from cmp.db.sql import Conn, Row, execute, fetch_all, fetch_one, keyset_clause

# ------------------------------------------------------------------ processor
PROCESSOR_COLUMNS = """
  p.processor_uuid, p.legal_name, p.type, p.contract_ref,
  p.security_confirmed_at, p.status, p.created_at
"""

PROCESSOR_SORTS = ("created_at", "legal_name", "security_confirmed_at")


async def processor_by_uuid(conn: Conn, processor_uuid: str) -> Row | None:
    return await fetch_one(
        conn,
        f"SELECT p.processor_id, {PROCESSOR_COLUMNS} FROM processor p WHERE p.processor_uuid = %s",
        (processor_uuid,),
    )


async def create_processor(
    conn: Conn,
    *,
    legal_name: str,
    type_: str,
    contract_ref: str,
    security_confirmed_at: Any,
) -> Row:
    row = await fetch_one(
        conn,
        """
        INSERT INTO processor (legal_name, type, contract_ref, security_confirmed_at)
        VALUES (%s, %s::processor_type, %s, %s)
        RETURNING processor_id, processor_uuid, legal_name, type, contract_ref,
                  security_confirmed_at, status, created_at
        """,
        (legal_name, type_, contract_ref, security_confirmed_at),
    )
    assert row is not None
    return row


async def update_processor(
    conn: Conn,
    processor_id: int,
    *,
    legal_name: str | None,
    contract_ref: str | None,
    security_confirmed_at: Any,
) -> Row:
    row = await fetch_one(
        conn,
        """
        UPDATE processor
           SET legal_name            = COALESCE(%s, legal_name),
               contract_ref          = COALESCE(%s, contract_ref),
               security_confirmed_at = COALESCE(%s, security_confirmed_at)
         WHERE processor_id = %s
        RETURNING processor_id, processor_uuid, legal_name, type, contract_ref,
                  security_confirmed_at, status, created_at
        """,
        (legal_name, contract_ref, security_confirmed_at, processor_id),
    )
    assert row is not None
    return row


async def suspend_processor(conn: Conn, processor_id: int) -> None:
    await conn.execute(
        "UPDATE processor SET status = 'suspended' WHERE processor_id = %s", (processor_id,)
    )


async def list_processors(
    conn: Conn, req: PageRequest, *, status: str | None = None, q: str | None = None
) -> tuple[list[Row], str | None, int]:
    where, params = ["1 = 1"], []
    if status:
        where.append("p.status = %s::record_status")
        params.append(status)
    if q:
        where.append("(p.legal_name ILIKE %s OR p.contract_ref ILIKE %s)")
        params.extend([f"%{q}%", f"%{q}%"])

    clause = " AND ".join(where)
    keyset, kparams = keyset_clause(req, alias="p", id_column="processor_id")
    rows = await fetch_all(
        conn,
        f"""SELECT p.processor_id AS _row_id, {PROCESSOR_COLUMNS},
            (SELECT count(*) FROM project_site s WHERE s.processor_id = p.processor_id) AS sites
            FROM processor p WHERE {clause}{keyset}""",
        [*params, *kparams],
    )
    total = await fetch_one(conn, f"SELECT count(*) AS n FROM processor p WHERE {clause}", params)
    items, cursor = build_page(rows, req)
    return items, cursor, int((total or {}).get("n", 0))


# ---------------------------------------------------------------- data_source
SOURCE_COLUMNS = """
  s.source_uuid, s.source_code, s.name, s.source_role, s.exchange_mode,
  s.id_scheme, s.is_authoritative_for, s.status, s.created_at
"""

SOURCE_SORTS = ("created_at", "name", "source_code")


async def source_by_uuid(conn: Conn, source_uuid: str) -> Row | None:
    return await fetch_one(
        conn,
        f"""SELECT s.source_id, {SOURCE_COLUMNS},
            pr.processor_uuid, pr.legal_name AS processor_name,
            ps.site_uuid, ps.site_label
            FROM data_source s
            LEFT JOIN processor pr ON pr.processor_id = s.processor_id
            LEFT JOIN project_site ps ON ps.site_id = s.site_id
            WHERE s.source_uuid = %s""",
        (source_uuid,),
    )


async def source_by_code(conn: Conn, source_code: str) -> Row | None:
    return await fetch_one(
        conn,
        f"SELECT s.source_id, {SOURCE_COLUMNS} FROM data_source s WHERE s.source_code = %s",
        (source_code,),
    )


async def create_source(
    conn: Conn,
    *,
    source_code: str,
    name: str,
    source_role: str,
    exchange_mode: str,
    id_scheme: str | None,
    processor_id: int | None,
    site_id: int | None,
    is_authoritative_for: list[str],
) -> Row:
    row = await fetch_one(
        conn,
        """
        INSERT INTO data_source (source_code, name, source_role, exchange_mode, id_scheme,
                                 processor_id, site_id, is_authoritative_for)
        VALUES (%s, %s, %s::source_role, %s::exchange_mode, %s, %s, %s, %s)
        RETURNING source_id, source_uuid, source_code, name, source_role, exchange_mode,
                  id_scheme, is_authoritative_for, status, created_at
        """,
        (
            source_code,
            name,
            source_role,
            exchange_mode,
            id_scheme,
            processor_id,
            site_id,
            is_authoritative_for,
        ),
    )
    assert row is not None
    return row


async def update_source(
    conn: Conn,
    source_id: int,
    *,
    name: str | None,
    id_scheme: str | None,
    is_authoritative_for: list[str] | None,
) -> Row:
    row = await fetch_one(
        conn,
        """
        UPDATE data_source
           SET name                 = COALESCE(%s, name),
               id_scheme            = COALESCE(%s, id_scheme),
               is_authoritative_for = COALESCE(%s, is_authoritative_for)
         WHERE source_id = %s
        RETURNING source_id, source_uuid, source_code, name, source_role, exchange_mode,
                  id_scheme, is_authoritative_for, status, created_at
        """,
        (name, id_scheme, is_authoritative_for, source_id),
    )
    assert row is not None
    return row


async def suspend_source(conn: Conn, source_id: int) -> None:
    await conn.execute(
        "UPDATE data_source SET status = 'suspended' WHERE source_id = %s", (source_id,)
    )


async def list_sources(
    conn: Conn,
    req: PageRequest,
    *,
    status: str | None = None,
    source_role: str | None = None,
    processor_uuid: str | None = None,
    q: str | None = None,
) -> tuple[list[Row], str | None, int]:
    where, params = ["1 = 1"], []
    if status:
        where.append("s.status = %s::record_status")
        params.append(status)
    if source_role:
        where.append("s.source_role = %s::source_role")
        params.append(source_role)
    if processor_uuid:
        # A subquery rather than a join predicate: the count query below shares
        # this clause and has no join to reach through.
        where.append(
            "s.processor_id = (SELECT processor_id FROM processor WHERE processor_uuid = %s)"
        )
        params.append(processor_uuid)
    if q:
        where.append("(s.name ILIKE %s OR s.source_code ILIKE %s)")
        params.extend([f"%{q}%", f"%{q}%"])

    clause = " AND ".join(where)
    keyset, kparams = keyset_clause(req, alias="s", id_column="source_id")
    rows = await fetch_all(
        conn,
        f"""SELECT s.source_id AS _row_id, {SOURCE_COLUMNS},
            pr.processor_uuid, pr.legal_name AS processor_name
            FROM data_source s
            LEFT JOIN processor pr ON pr.processor_id = s.processor_id
            WHERE {clause}{keyset}""",
        [*params, *kparams],
    )
    total = await fetch_one(conn, f"SELECT count(*) AS n FROM data_source s WHERE {clause}", params)
    items, cursor = build_page(rows, req)
    return items, cursor, int((total or {}).get("n", 0))


# -------------------------------------------------------------------- purpose
PURPOSE_COLUMNS = """
  p.purpose_uuid, p.purpose_code, p.version, p.status, p.name, p.description,
  p.uses, p.lawful_basis, p.s7_clause, p.data_categories,
  p.retention_period, p.retention_basis, p.erasure_trigger,
  p.consent_validity_period, p.cross_border_permitted, p.permitted_for_minors,
  p.lapse_behaviour, p.created_at, p.updated_at
"""

PURPOSE_SORTS = ("created_at", "name", "purpose_code", "status")


async def purpose_by_uuid(conn: Conn, purpose_uuid: str) -> Row | None:
    return await fetch_one(
        conn,
        f"SELECT p.purpose_id, {PURPOSE_COLUMNS} FROM purpose p WHERE p.purpose_uuid = %s",
        (purpose_uuid,),
    )


async def purpose_by_id(conn: Conn, purpose_id: int) -> Row | None:
    return await fetch_one(
        conn,
        f"SELECT p.purpose_id, {PURPOSE_COLUMNS} FROM purpose p WHERE p.purpose_id = %s",
        (purpose_id,),
    )


async def create_purpose(conn: Conn, *, created_by: int, **f: Any) -> Row:
    row = await fetch_one(
        conn,
        """
        INSERT INTO purpose (purpose_code, name, description, uses, lawful_basis, s7_clause,
                             data_categories, retention_period, retention_basis,
                             erasure_trigger, consent_validity_period, cross_border_permitted,
                             permitted_for_minors, lapse_behaviour, created_by)
        VALUES (%(purpose_code)s, %(name)s, %(description)s, %(uses)s,
                %(lawful_basis)s::lawful_basis, %(s7_clause)s::s7_clause,
                %(data_categories)s, %(retention_period)s::interval,
                %(retention_basis)s::retention_basis, %(erasure_trigger)s::erasure_trigger,
                %(consent_validity_period)s::interval, %(cross_border_permitted)s,
                %(permitted_for_minors)s, %(lapse_behaviour)s::lapse_behaviour, %(created_by)s)
        RETURNING purpose_id, purpose_uuid, purpose_code, version, status, name, description,
                  uses, lawful_basis, s7_clause, data_categories, retention_period,
                  retention_basis, erasure_trigger, consent_validity_period,
                  cross_border_permitted, permitted_for_minors, lapse_behaviour,
                  created_at, updated_at
        """,
        {**f, "created_by": created_by},
    )
    assert row is not None
    return row


async def update_purpose(conn: Conn, purpose_id: int, **f: Any) -> Row:
    row = await fetch_one(
        conn,
        """
        UPDATE purpose SET
          name                    = COALESCE(%(name)s, name),
          description             = COALESCE(%(description)s, description),
          uses                    = COALESCE(%(uses)s, uses),
          lawful_basis            = COALESCE(%(lawful_basis)s::lawful_basis, lawful_basis),
          s7_clause               = %(s7_clause)s::s7_clause,
          data_categories         = COALESCE(%(data_categories)s, data_categories),
          retention_period        = COALESCE(%(retention_period)s::interval, retention_period),
          retention_basis         = COALESCE(%(retention_basis)s::retention_basis, retention_basis),
          erasure_trigger         = COALESCE(%(erasure_trigger)s::erasure_trigger, erasure_trigger),
          consent_validity_period = %(consent_validity_period)s::interval,
          cross_border_permitted  = COALESCE(%(cross_border_permitted)s, cross_border_permitted),
          permitted_for_minors    = COALESCE(%(permitted_for_minors)s, permitted_for_minors),
          lapse_behaviour         = COALESCE(%(lapse_behaviour)s::lapse_behaviour, lapse_behaviour)
        WHERE purpose_id = %(purpose_id)s
        RETURNING purpose_id, purpose_uuid, purpose_code, version, status, name, description,
                  uses, lawful_basis, s7_clause, data_categories, retention_period,
                  retention_basis, erasure_trigger, consent_validity_period,
                  cross_border_permitted, permitted_for_minors, lapse_behaviour,
                  created_at, updated_at
        """,
        {**f, "purpose_id": purpose_id},
    )
    assert row is not None
    return row


async def set_purpose_status(conn: Conn, purpose_id: int, status: str) -> Row:
    row = await fetch_one(
        conn,
        """UPDATE purpose SET status = %s::purpose_status WHERE purpose_id = %s
           RETURNING purpose_uuid, purpose_code, status""",
        (status, purpose_id),
    )
    assert row is not None
    return row


async def list_purposes(
    conn: Conn,
    req: PageRequest,
    *,
    status: str | None = None,
    lawful_basis: str | None = None,
    q: str | None = None,
) -> tuple[list[Row], str | None, int]:
    where, params = ["1 = 1"], []
    if status:
        where.append("p.status = %s::purpose_status")
        params.append(status)
    if lawful_basis:
        where.append("p.lawful_basis = %s::lawful_basis")
        params.append(lawful_basis)
    if q:
        where.append("(p.name ILIKE %s OR p.purpose_code ILIKE %s)")
        params.extend([f"%{q}%", f"%{q}%"])

    clause = " AND ".join(where)
    keyset, kparams = keyset_clause(req, alias="p", id_column="purpose_id")
    rows = await fetch_all(
        conn,
        f"SELECT p.purpose_id AS _row_id, {PURPOSE_COLUMNS} FROM purpose p WHERE {clause}{keyset}",
        [*params, *kparams],
    )
    total = await fetch_one(conn, f"SELECT count(*) AS n FROM purpose p WHERE {clause}", params)
    items, cursor = build_page(rows, req)
    return items, cursor, int((total or {}).get("n", 0))


async def purpose_versions(conn: Conn, purpose_code: str) -> list[Row]:
    return await fetch_all(
        conn,
        f"""SELECT p.purpose_id, {PURPOSE_COLUMNS} FROM purpose p
            WHERE p.purpose_code = %s ORDER BY p.version DESC""",
        (purpose_code,),
    )


async def purpose_usage(conn: Conn, purpose_id: int) -> list[Row]:
    """Which notices reference this purpose.

    Retiring a purpose still attached to a published notice must be blocked, and
    this is how the UI knows before the user tries.
    """
    return await fetch_all(
        conn,
        """
        SELECT n.notice_uuid, n.notice_code, n.version, n.status, n.published_at,
               pr.project_uuid, pr.project_name, np.is_mandatory
        FROM notice_purpose np
        JOIN notice n  ON n.notice_id = np.notice_id
        JOIN project pr ON pr.project_id = n.project_id
        WHERE np.purpose_id = %s
        ORDER BY n.published_at DESC NULLS LAST, n.notice_id DESC
        """,
        (purpose_id,),
    )


async def purpose_is_published_anywhere(conn: Conn, purpose_id: int) -> bool:
    row = await fetch_one(
        conn,
        """SELECT EXISTS (
             SELECT 1 FROM notice_purpose np JOIN notice n ON n.notice_id = np.notice_id
             WHERE np.purpose_id = %s AND n.status IN ('published','superseded')
           ) AS live""",
        (purpose_id,),
    )
    return bool((row or {}).get("live"))


async def bind_source_to_site(conn: Conn, *, source_id: int, site_id: int) -> None:
    """Point a data source at the collection site it reports from.

    One source serves one site: `data_source.site_id` is a single column, so
    binding a source that already names another site moves it. That is the right
    behaviour - a rig physically stands in one place - but it is a change worth
    seeing, which is why the caller audits it.
    """
    await execute(
        conn,
        "UPDATE data_source SET site_id = %s WHERE source_id = %s",
        (site_id, source_id),
    )
