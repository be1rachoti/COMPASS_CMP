"""delegation.

One person covering another's row access for a period. Reads and writes only —
what a delegation *means* is decided in `cmp.domain.delegations`, and where it
takes effect is the scope predicate in `projects.py`, which calls
`cmp_delegators_of()` rather than anything here.

That separation matters: if this module also decided who may delegate to whom,
there would be two places to check when the answer changed.
"""

from __future__ import annotations

from datetime import datetime

from cmp.db.sql import Conn, Row, fetch_all, fetch_one

_SELECT = """
  d.delegation_uuid, d.reason, d.starts_at, d.ends_at, d.revoked_at, d.created_at,
  dr.uuid AS delegator_uuid, dr.full_name AS delegator_name,
  dr.email AS delegator_email, dr.role AS delegator_role,
  de.uuid AS delegate_uuid,  de.full_name AS delegate_name,
  de.email AS delegate_email, de.role AS delegate_role,
  -- Computed here rather than in the caller so every surface agrees on what
  -- "active" means, and agrees with cmp_delegators_of().
  (d.revoked_at IS NULL AND d.starts_at <= now()
   AND (d.ends_at IS NULL OR d.ends_at > now())) AS is_active
"""

_FROM = """
  FROM delegation d
  JOIN auth_user dr ON dr.id = d.delegator_user_id
  JOIN auth_user de ON de.id = d.delegate_user_id
"""


async def create(
    conn: Conn,
    *,
    delegator_user_id: int,
    delegate_user_id: int,
    reason: str | None,
    starts_at: datetime | None,
    ends_at: datetime | None,
    created_by: int,
) -> Row:
    row = await fetch_one(
        conn,
        """
        INSERT INTO delegation
          (delegator_user_id, delegate_user_id, reason, starts_at, ends_at, created_by)
        VALUES (%s, %s, %s, COALESCE(%s, now()), %s, %s)
        RETURNING delegation_id, delegation_uuid
        """,
        (delegator_user_id, delegate_user_id, reason, starts_at, ends_at, created_by),
    )
    assert row is not None
    return row


async def by_uuid(conn: Conn, delegation_uuid: str) -> Row | None:
    return await fetch_one(
        conn,
        f"SELECT d.delegation_id, d.delegator_user_id, d.delegate_user_id, {_SELECT}{_FROM} "
        "WHERE d.delegation_uuid = %s",
        (delegation_uuid,),
    )


async def revoke(conn: Conn, delegation_id: int, *, revoked_by: int) -> None:
    """End a delegation now.

    Guarded on `revoked_at IS NULL` so revoking twice is a no-op rather than a
    rewritten timestamp — the record should say when cover actually ended, not
    when somebody last pressed the button.
    """
    await conn.execute(
        "UPDATE delegation SET revoked_at = now(), revoked_by = %s "
        "WHERE delegation_id = %s AND revoked_at IS NULL",
        (revoked_by, delegation_id),
    )


async def granted_by(conn: Conn, user_id: int) -> list[Row]:
    """Cover this person has arranged for their own work."""
    return await fetch_all(
        conn,
        f"SELECT {_SELECT}{_FROM} WHERE d.delegator_user_id = %s "
        "ORDER BY d.revoked_at IS NOT NULL, d.starts_at DESC",
        (user_id,),
    )


async def held_by(conn: Conn, user_id: int) -> list[Row]:
    """Cover this person is providing for others."""
    return await fetch_all(
        conn,
        f"SELECT {_SELECT}{_FROM} WHERE d.delegate_user_id = %s "
        "ORDER BY d.revoked_at IS NOT NULL, d.starts_at DESC",
        (user_id,),
    )


async def all_current(conn: Conn) -> list[Row]:
    """Every live delegation, for the DPO and administrator overview.

    "Who is covering what, right now" is a question a privacy function is asked
    and answers badly from a rota spreadsheet.
    """
    return await fetch_all(
        conn,
        f"""
        SELECT {_SELECT}{_FROM}
         WHERE d.revoked_at IS NULL
           AND d.starts_at <= now()
           AND (d.ends_at IS NULL OR d.ends_at > now())
         ORDER BY d.starts_at DESC
        """,
    )


async def live_between(conn: Conn, *, delegator_user_id: int, delegate_user_id: int) -> Row | None:
    """An existing live delegation between these two, if any.

    Checked before granting so a repeated request reports the delegation that
    already covers it rather than failing on a unique index with a message about
    a constraint name.
    """
    return await fetch_one(
        conn,
        f"""
        SELECT d.delegation_id, {_SELECT}{_FROM}
         WHERE d.delegator_user_id = %s AND d.delegate_user_id = %s
           AND d.revoked_at IS NULL
           AND (d.ends_at IS NULL OR d.ends_at > now())
        """,
        (delegator_user_id, delegate_user_id),
    )
