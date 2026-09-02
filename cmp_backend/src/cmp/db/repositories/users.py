"""auth_user and person_type_history.

No business logic here. The repository knows how to fetch and store rows; whether
a person *may* have their role changed is a question for the service.

Every read that a scoped caller can reach takes the scope as a WHERE predicate,
not as a filter applied afterwards.
"""

from __future__ import annotations

from typing import Any

from cmp.core.pagination import PageRequest, build_page
from cmp.db.sql import Conn, Row, execute, fetch_all, fetch_one, keyset_clause, require_one

# The columns any caller may see. `password_hash` is not among them and must
# never be added: a SELECT * here is one refactor away from a response body.
PUBLIC_COLUMNS = """
  u.uuid, u.username, u.full_name, u.email, u.mobile, u.organization_id,
  u.role, u.person_type, u.status, u.dob,
  -- Derived in SQL rather than in Python, because more than one caller asks and
  -- the answer changes on a birthday without the row being written to. NULL
  -- when the date of birth is unknown, which is not the same as adult.
  cmp_is_minor(u.dob) AS is_minor,
  u.created_at, u.updated_at
"""


async def by_uuid(conn: Conn, user_uuid: str) -> Row | None:
    return await fetch_one(
        conn, f"SELECT u.id, {PUBLIC_COLUMNS} FROM auth_user u WHERE u.uuid = %s", (user_uuid,)
    )


async def require_by_uuid(conn: Conn, user_uuid: str) -> Row:
    return await require_one(
        conn,
        f"SELECT u.id, {PUBLIC_COLUMNS} FROM auth_user u WHERE u.uuid = %s",
        (user_uuid,),
        entity="User",
    )


async def by_id(conn: Conn, user_id: int) -> Row | None:
    return await fetch_one(
        conn, f"SELECT u.id, {PUBLIC_COLUMNS} FROM auth_user u WHERE u.id = %s", (user_id,)
    )


async def credentials_by_login(conn: Conn, login: str) -> Row | None:
    """Fetch the hash for a sign-in attempt.

    Matched case-insensitively on email or username: people type their address
    with whatever capitalisation their keyboard produced, and a sign-in that
    fails on case is a support ticket, not a security control.
    """
    return await fetch_one(
        conn,
        """
        SELECT u.id, u.uuid, u.email, u.username, u.full_name, u.role, u.status,
               u.password_hash
        FROM auth_user u
        WHERE lower(u.email) = lower(%s) OR lower(u.username) = lower(%s)
        """,
        (login, login),
    )


async def by_email(conn: Conn, email: str) -> Row | None:
    return await fetch_one(
        conn,
        f"SELECT u.id, {PUBLIC_COLUMNS} FROM auth_user u WHERE lower(u.email) = lower(%s)",
        (email,),
    )


async def by_contact(conn: Conn, contact: str) -> Row | None:
    """Resolve a data subject by email or mobile - the two things they know."""
    return await fetch_one(
        conn,
        f"""
        SELECT u.id, {PUBLIC_COLUMNS} FROM auth_user u
        WHERE lower(u.email) = lower(%s) OR u.mobile = %s
        """,
        (contact, contact),
    )


async def create(
    conn: Conn,
    *,
    full_name: str,
    email: str,
    role: str,
    username: str | None = None,
    mobile: str | None = None,
    organization_id: str | None = None,
    person_type: str | None = None,
    status: str = "pending",
    password_hash: str | None = None,
    registered_via_link_id: int | None = None,
    #: Section 9 makes this load-bearing for a data subject: it decides whether
    #: the account is a child's. Optional here because a consent link does not
    #: ask, and an assumed date would be worse than an absent one.
    dob: str | None = None,
) -> Row:
    row = await fetch_one(
        conn,
        """
        INSERT INTO auth_user (username, full_name, email, mobile, organization_id,
                               role, person_type, status, password_hash,
                               registered_via_link_id, dob)
        VALUES (%s, %s, %s, %s, %s, %s::user_role, %s::person_type, %s::user_status, %s, %s,
                %s::date)
        RETURNING id, uuid, username, full_name, email, mobile, organization_id,
                  role, person_type, status, dob, cmp_is_minor(dob) AS is_minor,
                  created_at, updated_at
        """,
        (
            username,
            full_name,
            email,
            mobile,
            organization_id,
            role,
            person_type,
            status,
            password_hash,
            registered_via_link_id,
            dob,
        ),
    )
    assert row is not None
    return row


async def update_profile(
    conn: Conn,
    user_id: int,
    *,
    full_name: str | None = None,
    mobile: str | None = None,
    organization_id: str | None = None,
    dob: str | None = None,
) -> Row:
    """Partial update. COALESCE keeps an omitted field unchanged rather than nulling it."""
    row = await fetch_one(
        conn,
        """
        UPDATE auth_user
           SET full_name       = COALESCE(%s, full_name),
               mobile          = COALESCE(%s, mobile),
               organization_id = COALESCE(%s, organization_id),
               dob             = COALESCE(%s::date, dob)
         WHERE id = %s
        RETURNING id, uuid, username, full_name, email, mobile, organization_id,
                  role, person_type, status, dob, cmp_is_minor(dob) AS is_minor,
                  created_at, updated_at
        """,
        (full_name, mobile, organization_id, dob, user_id),
    )
    assert row is not None
    return row


async def set_role(conn: Conn, user_id: int, role: str) -> Row:
    row = await fetch_one(
        conn,
        """
        UPDATE auth_user SET role = %s::user_role WHERE id = %s
        RETURNING id, uuid, full_name, email, role, status
        """,
        (role, user_id),
    )
    assert row is not None
    return row


async def set_status(conn: Conn, user_id: int, status: str) -> Row:
    row = await fetch_one(
        conn,
        """
        UPDATE auth_user SET status = %s::user_status WHERE id = %s
        RETURNING id, uuid, full_name, email, role, status
        """,
        (status, user_id),
    )
    assert row is not None
    return row


async def set_password(conn: Conn, user_id: int, password_hash: str) -> None:
    await execute(
        conn, "UPDATE auth_user SET password_hash = %s WHERE id = %s", (password_hash, user_id)
    )


async def set_person_type(conn: Conn, user_id: int, person_type: str) -> Row:
    row = await fetch_one(
        conn,
        """
        UPDATE auth_user SET person_type = %s::person_type WHERE id = %s
        RETURNING id, uuid, full_name, person_type
        """,
        (person_type, user_id),
    )
    assert row is not None
    return row


# ------------------------------------------------------------------ listing
LIST_SORTS = ("created_at", "full_name", "email", "role", "status")


async def list_users(
    conn: Conn,
    req: PageRequest,
    *,
    role: str | None = None,
    status: str | None = None,
    person_type: str | None = None,
    q: str | None = None,
) -> tuple[list[Row], str | None, int]:
    where = ["1 = 1"]
    params: list[Any] = []

    if role:
        where.append("u.role = %s::user_role")
        params.append(role)
    if status:
        where.append("u.status = %s::user_status")
        params.append(status)
    if person_type:
        where.append("u.person_type = %s::person_type")
        params.append(person_type)
    if q:
        # Bounded prefix/substring search over the three fields a person is
        # looked up by. ILIKE is adequate at this scale; if the register grows
        # past six figures this becomes a trigram index, not a bigger LIKE.
        where.append("(u.full_name ILIKE %s OR u.email ILIKE %s OR u.organization_id ILIKE %s)")
        like = f"%{q}%"
        params.extend([like, like, like])

    clause = " AND ".join(where)
    keyset, keyset_params = keyset_clause(req, alias="u", id_column="id")

    rows = await fetch_all(
        conn,
        f"SELECT u.id AS _row_id, {PUBLIC_COLUMNS} FROM auth_user u WHERE {clause}{keyset}",
        [*params, *keyset_params],
    )
    total = await fetch_one(conn, f"SELECT count(*) AS n FROM auth_user u WHERE {clause}", params)
    items, next_cursor = build_page(rows, req)
    return items, next_cursor, int((total or {}).get("n", 0))


# --------------------------------------------------------- person type history
async def record_person_type_change(
    conn: Conn,
    *,
    user_id: int,
    from_type: str | None,
    to_type: str,
    reason: str | None,
    changed_by: int,
) -> Row:
    row = await fetch_one(
        conn,
        """
        INSERT INTO person_type_history (auth_user_id, from_type, to_type, reason, changed_by)
        VALUES (%s, %s::person_type, %s::person_type, %s, %s)
        RETURNING history_uuid, from_type, to_type, reason, changed_at
        """,
        (user_id, from_type, to_type, reason, changed_by),
    )
    assert row is not None
    return row


async def person_type_history(conn: Conn, user_id: int) -> list[Row]:
    return await fetch_all(
        conn,
        """
        SELECT h.history_uuid, h.from_type, h.to_type, h.reason, h.changed_at,
               a.uuid AS changed_by_uuid, a.full_name AS changed_by_name
        FROM person_type_history h
        JOIN auth_user a ON a.id = h.changed_by
        WHERE h.auth_user_id = %s
        ORDER BY h.changed_at DESC
        """,
        (user_id,),
    )


async def count_by_role(conn: Conn) -> dict[str, int]:
    rows = await fetch_all(
        conn, "SELECT role::text AS role, count(*) AS n FROM auth_user GROUP BY role"
    )
    return {r["role"]: int(r["n"]) for r in rows}


async def count_by_status(conn: Conn) -> dict[str, int]:
    rows = await fetch_all(
        conn, "SELECT status::text AS status, count(*) AS n FROM auth_user GROUP BY status"
    )
    return {r["status"]: int(r["n"]) for r in rows}


async def collection_owners(conn: Conn) -> list[Row]:
    """Active people who can be accountable for a data source.

    Deliberately its own query rather than a filter on the register. A DCO Admin
    routing a project, or an R&D owner naming an RCO, has to pick a person and
    has no business reading the account register - so this returns the minimum
    that makes the choice possible: who they are, enough to tell two people with
    the same name apart, and which kind of owner they are. No status, no person
    type, no organisation id, no contact history.

    The role comes back because it constrains the choice rather than merely
    describing it: an RCO is accountable for collection the R&D team does itself
    and a DCO for a third party's, so the caller filters by which the source is.
    """
    return await fetch_all(
        conn,
        """SELECT u.uuid, u.full_name, u.email, u.role
           FROM auth_user u
           WHERE u.role IN ('dco', 'rco') AND u.status = 'active'
           ORDER BY u.role, u.full_name""",
    )
