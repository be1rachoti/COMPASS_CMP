"""project, project_status_history, project_approval, project_site.

Row scope lives here, in the WHERE clause, because that is the only place it is
real. `scope_predicate` is applied to every read a scoped caller can reach:

* DPO       - every row.
* DCO / RCO - projects deploying a data source they own (read), and projects
              whose primary site is theirs (write). See `scope_predicate`.
* DCO Admin - every project collected by a third party, read and write. Their
              job is to route those, and a router that cannot see the queue
              cannot do it.
* RnD User  - projects they created.
* Admin     - none. Administrators manage accounts, not collections.

A caller outside scope gets no row, which surfaces as 404. That is deliberate:
403 would confirm the project exists.
"""

from __future__ import annotations

from typing import Any

from cmp.core.errors import Conflict
from cmp.core.pagination import PageRequest, build_page
from cmp.core.permissions import Role, Scope, scope_of
from cmp.db.sql import Conn, Row, fetch_all, fetch_one, keyset_clause, require_one

PROJECT_COLUMNS = """
  p.project_uuid, p.project_name, p.internal_project_name, p.description,
  p.requesting_team, p.project_status, p.created_at, p.updated_at
"""


#: The caller runs a site on this project — or is covering for whoever does.
#:
#: "Runs" resolves the same way everywhere: the site's override where there is
#: one, otherwise the owner of the source deployed at it. Reading only the
#: source owner here would have let somebody be *named* for a site on a screen
#: and then be unable to open the project they had been named on.
#:
#: Ownership sits on `data_source`, not on the site. The same rig serving three
#: projects has one owner, recorded once; before 0007 it was recorded three times
#: and nothing stopped those three disagreeing.
#:
#: Written as EXISTS rather than a join because it is used inside a WHERE on a
#: list query: a join would multiply rows for a project deploying several of
#: their sources, and the fix for that is a DISTINCT that also defeats the keyset
#: cursor.
#:
#: `cmp_delegators_of` is where "currently" is defined — not revoked, started,
#: not ended. Inlining that test here would put the definition in two places.
_RUNS_A_SITE = """EXISTS (
    SELECT 1 FROM project_site ps
      LEFT JOIN data_source ds ON ds.source_id = ps.source_id
     WHERE ps.project_id = p.project_id
       AND ps.status = 'active'
       AND (coalesce(ps.dco_override_user_id, ds.owner_user_id) = %s
            OR coalesce(ps.dco_override_user_id, ds.owner_user_id)
                 IN (SELECT delegator_user_id FROM cmp_delegators_of(%s)))
)"""


#: A DCO Admin's whole scope: projects somebody outside is collecting for.
#:
#: No user id appears in it, and that is the point rather than an oversight — the
#: role is defined by the work, not by assignment. It takes no parameters, so it
#: is also the one predicate that costs nothing to evaluate per row.
_COLLECTED_BY_A_THIRD_PARTY = """EXISTS (
    SELECT 1 FROM project_processor pp
      JOIN processor pr ON pr.processor_id = pp.processor_id
     WHERE pp.project_id = p.project_id
       AND NOT pr.is_in_house
)"""


def scope_predicate(
    role: Role | str, user_id: int, *, write: bool = False
) -> tuple[str, list[Any]]:
    """The WHERE fragment that implements row scope for this role.

    A DCO's scope is two different predicates, and the difference is the point of
    the source-ownership model:

    * **Read** — any project with an active site they run, whether that is
      through owning its source or through being named on the site itself. A
      campus lead who runs one of a study's three locations has to be able to
      see the study.
    * **Write** — only projects whose *primary* site is theirs, which is what
      `project.dco_user_id` holds (kept in step by `trg_site_owner` and
      `trg_source_owner`). One owner acts; the others watch their own sources.

    An **RCO** is the same shape. The role name records that they are accountable
    for collection the R&D team does itself rather than for a third party's, and
    that distinction lives on the processor - not in who may see what. Giving them
    a separate predicate would be two copies of one rule.

    A **DCO Admin** is not that shape at all, so it is answered before the scope
    lookup: they hold every third-party project, read and write, because routing
    them is the job.

    Passing `write=True` for a read is harmless and merely narrow. Passing it the
    other way round is not, which is why the default is the strict one.
    """
    if Role(role) is Role.DCO_ADMIN:
        return _COLLECTED_BY_A_THIRD_PARTY, []

    scope = scope_of("project", role)
    match scope:
        case Scope.ALL:
            return "TRUE", []
        case Scope.SCOPED:
            if write:
                # Owner, or covering for the owner. A delegate acts with the
                # delegator's authority — that is what makes cover useful rather
                # than merely visible.
                return (
                    "(p.dco_user_id = %s OR p.dco_user_id IN "
                    "(SELECT delegator_user_id FROM cmp_delegators_of(%s)))",
                    [user_id, user_id],
                )
            # Owner *or* site-holder. The first disjunct is an index lookup and
            # short-circuits for the common case.
            return (
                f"(p.dco_user_id = %s OR p.dco_user_id IN "
                f"(SELECT delegator_user_id FROM cmp_delegators_of(%s)) "
                f"OR {_RUNS_A_SITE})",
                [user_id, user_id, user_id, user_id],
            )
        case Scope.OWN:
            return "p.created_by = %s", [user_id]
        case _:
            return "FALSE", []


def site_scope_predicate(
    role: Role | str, user_id: int, *, alias: str = "s"
) -> tuple[str, list[Any]]:
    """Which *sites* this caller may see, as a WHERE fragment.

    Distinct from `scope_predicate`, which answers the same question about
    projects, and the gap between the two was a real hole. A project spanning a
    third party's campus and an in-house lab is one project with two collection
    owners; reaching the project because you run one of its sites let you reach
    *all* of them - and mint a consent link for somebody else's.

    So a collection owner sees the sites they run and no others. Note that this
    is stricter than "sites under a processor of my kind": a DCO does not see
    another DCO's campus either, which is the same rule applied consistently
    rather than a special case for the in-house boundary.

    * **DPO, administrator** - every site.
    * **DCO Admin** - every site not collected in-house. Routing third-party
      collection is the job, and a site with no processor yet is included
      because assigning one is part of it.
    * **DCO, RCO** - sites they run, resolved through the same coalesce
      everything else uses: the override where there is one, otherwise the
      source's owner. Cover counts, as it does everywhere.
    * **R&D User** - every site on a project they created. They designed the
      study and arranged its partners; seeing where it collects is not a
      privilege over somebody else's work.
    """
    r = Role(role)

    if r in (Role.DPO, Role.ADMIN):
        return "TRUE", []

    if r is Role.DCO_ADMIN:
        return (
            f"""NOT EXISTS (
                SELECT 1 FROM processor pr_scope
                 WHERE pr_scope.processor_id = {alias}.processor_id
                   AND pr_scope.is_in_house
            )""",
            [],
        )

    if r in (Role.DCO, Role.RCO):
        # A correlated subquery rather than a join, so the fragment drops into
        # any query without the caller having to bring `data_source` with it -
        # and without a join multiplying rows on a list that has a keyset cursor.
        return (
            f"""EXISTS (
                SELECT 1 FROM project_site sc_site
                  LEFT JOIN data_source sc_src ON sc_src.source_id = sc_site.source_id
                 WHERE sc_site.site_id = {alias}.site_id
                   AND (coalesce(sc_site.dco_override_user_id, sc_src.owner_user_id) = %s
                        OR coalesce(sc_site.dco_override_user_id, sc_src.owner_user_id)
                             IN (SELECT delegator_user_id FROM cmp_delegators_of(%s)))
            )""",
            [user_id, user_id],
        )

    if r is Role.RND_USER:
        return (
            f"""EXISTS (
                SELECT 1 FROM project p_scope
                 WHERE p_scope.project_id = {alias}.project_id
                   AND p_scope.created_by = %s
            )""",
            [user_id],
        )

    return "FALSE", []


async def by_uuid(
    conn: Conn, project_uuid: str, *, role: Role | str, user_id: int, write: bool = False
) -> Row | None:
    pred, params = scope_predicate(role, user_id, write=write)
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


async def require(
    conn: Conn, project_uuid: str, *, role: Role | str, user_id: int, write: bool = False
) -> Row:
    """Fetch a project the caller may reach, or raise.

    `write=True` narrows a DCO to projects they *own* rather than merely hold a
    site on. Callers that mutate pass it; callers that read do not.

    The failure is `NotFound`, not `Forbidden`, in both cases. A DCO who can see
    a project but not write to it gets 404 on the write rather than 403 — the
    distinction between "no such project" and "not yours to change" is not one
    the API volunteers, because volunteering it confirms the project exists to
    somebody probing uuids.
    """
    row = await by_uuid(conn, project_uuid, role=role, user_id=user_id, write=write)
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
        (
            project_name,
            internal_project_name,
            description,
            requesting_team,
            created_by,
            dco_user_id,
        ),
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
    pred, scope_params = scope_predicate(role, user_id)
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
    total = await fetch_one(conn, f"SELECT count(*) AS n FROM project p WHERE {clause}", params)
    items, next_cursor = build_page(rows, req)
    return items, next_cursor, int((total or {}).get("n", 0))


# --------------------------------------------------------- who collects, where
async def processors_for(conn: Conn, project_id: int, *, status: str | None = None) -> list[Row]:
    """Who is on this project's list, and where each one stands.

    Returns every row by default, pending and rejected included, because the
    screens showing this list need to say what is outstanding. Callers deciding
    whether something is *permitted* must not use it that way - see
    `approved_processor_uuids`, which exists so that check cannot be written by
    accident against a request nobody has agreed to.
    """
    clause = "AND pp.status = %s::processor_request_status" if status else ""
    params: list[Any] = [project_id]
    if status:
        params.append(status)
    return await fetch_all(
        conn,
        f"""SELECT pr.processor_uuid, pr.legal_name, pr.type, pr.is_in_house,
                  pr.status AS processor_status,
                  pp.status, pp.added_at, pp.decided_at, pp.decision_reason,
                  asked.full_name   AS requested_by_name,
                  decider.full_name AS decided_by_name,
                  -- Whether anything is collecting under it yet. A processor
                  -- approved and never deployed is the signal its collection
                  -- owner is waiting on, and nothing else says so.
                  EXISTS (SELECT 1 FROM project_site ps
                           WHERE ps.project_id = pp.project_id
                             AND ps.processor_id = pp.processor_id
                             AND ps.status = 'active') AS has_site
             FROM project_processor pp
             JOIN processor pr ON pr.processor_id = pp.processor_id
             LEFT JOIN auth_user asked   ON asked.id = pp.added_by
             LEFT JOIN auth_user decider ON decider.id = pp.decided_by
            WHERE pp.project_id = %s {clause}
            ORDER BY pp.status, pr.legal_name""",
        params,
    )


async def approved_processor_uuids(conn: Conn, project_id: int) -> set[str]:
    """The processors this project may actually collect through.

    Its own function, and every permission check goes through it, because the
    difference between "on the list" and "agreed to" is the whole point of the
    amendment flow. A check written against `processors_for` would let a site be
    deployed under a processor the DPO had not seen - which is precisely what
    asking them was for.
    """
    rows = await fetch_all(
        conn,
        """SELECT pr.processor_uuid FROM project_processor pp
             JOIN processor pr ON pr.processor_id = pp.processor_id
            WHERE pp.project_id = %s AND pp.status = 'approved'""",
        (project_id,),
    )
    return {str(r["processor_uuid"]) for r in rows}


async def request_processor(
    conn: Conn, project_id: int, processor_id: int, *, actor_id: int, pending: bool
) -> Row:
    """Put a processor on a project's list, agreed or awaiting agreement.

    `pending` is decided by the caller from the project's state rather than read
    here: in draft the DPO reviews the whole project and everything on it, so a
    processor added then needs no separate decision. After approval it does.

    Re-asking after a refusal resets the row rather than colliding with the
    unique constraint. A DPO who said no in March should not have to be argued
    with through a workaround in September.
    """
    row = await fetch_one(
        conn,
        """INSERT INTO project_processor (project_id, processor_id, added_by, status)
           VALUES (%(project)s, %(processor)s, %(actor)s,
                   CASE WHEN %(pending)s THEN 'pending' ELSE 'approved' END
                     ::processor_request_status)
           ON CONFLICT (project_id, processor_id) DO UPDATE
              SET status          = EXCLUDED.status,
                  added_by        = EXCLUDED.added_by,
                  added_at        = now(),
                  decided_by      = NULL,
                  decided_at      = NULL,
                  decision_reason = NULL
              -- Only a refused request may be re-opened. An approved one is
              -- already agreed, and re-asking would quietly withdraw it.
              WHERE project_processor.status = 'rejected'
        RETURNING project_processor_id, status""",
        {
            "project": project_id,
            "processor": processor_id,
            "actor": actor_id,
            "pending": pending,
        },
    )
    if row is None:
        raise Conflict(
            "That processor is already on this project",
            code="processor_already_named",
        )
    return row


async def decide_processor(
    conn: Conn,
    project_id: int,
    processor_id: int,
    *,
    approved: bool,
    actor_id: int,
    reason: str | None,
) -> Row | None:
    """Record the DPO's answer on one pending request."""
    return await fetch_one(
        conn,
        """UPDATE project_processor
              SET status = CASE WHEN %(approved)s THEN 'approved' ELSE 'rejected' END
                           ::processor_request_status,
                  decided_by      = %(actor)s,
                  decided_at      = now(),
                  decision_reason = %(reason)s
            WHERE project_id = %(project)s
              AND processor_id = %(processor)s
              AND status = 'pending'
        RETURNING project_processor_id, status""",
        {
            "approved": approved,
            "actor": actor_id,
            "reason": reason,
            "project": project_id,
            "processor": processor_id,
        },
    )


async def pending_processor_requests(conn: Conn, limit: int = 25) -> list[Row]:
    """Every amendment waiting on a DPO, across all projects.

    Unscoped because the DPO's own scope is every project; it is their queue and
    nobody else's.
    """
    return await fetch_all(
        conn,
        """SELECT p.project_uuid, p.project_name, p.project_status,
                  pr.processor_uuid, pr.legal_name, pr.is_in_house,
                  pp.added_at, asked.full_name AS requested_by_name
             FROM project_processor pp
             JOIN project p    ON p.project_id = pp.project_id
             JOIN processor pr ON pr.processor_id = pp.processor_id
             LEFT JOIN auth_user asked ON asked.id = pp.added_by
            WHERE pp.status = 'pending'
            ORDER BY pp.added_at
            LIMIT %s""",
        (limit,),
    )


async def set_processors(
    conn: Conn, project_id: int, processor_ids: list[int], *, actor_id: int
) -> None:
    """Replace a draft project's processors with exactly this set.

    Replace rather than append: the caller sends the full list it wants, so a
    processor dropped from that list is dropped here. Additions keep their
    original `added_at` through DO NOTHING, because re-saving a form is not a
    re-decision and should not restamp who chose what and when.

    Draft only, which the service enforces. After approval a processor is added
    one at a time and by request - see `request_processor` - because each one
    needs the DPO's answer, and a set-replace has nowhere to put three different
    answers.
    """
    await conn.execute(
        """DELETE FROM project_processor
            WHERE project_id = %s AND NOT (processor_id = ANY(%s))""",
        (project_id, processor_ids),
    )
    for pid in processor_ids:
        await conn.execute(
            """INSERT INTO project_processor (project_id, processor_id, added_by, status)
               VALUES (%s, %s, %s, 'approved')
               ON CONFLICT (project_id, processor_id) DO NOTHING""",
            (project_id, pid, actor_id),
        )


async def collection_route(conn: Conn, project_id: int) -> dict[str, Any]:
    """Who this project goes to once it is approved.

    Two answers, and a project can need both at once - a study running at a
    partner campus and in-house is ordinary.

    * A **third-party** processor means somebody outside picks up the work, so it
      goes to a DCO Admin, who assigns the data sources. Because a source carries
      its own owner, assigning the sources is what decides which DCO ends up with
      it - there is no separate step where anybody names a person.
    * An **in-house** processor means we collect it ourselves. There is no DCO to
      route to, so it goes back to the R&D owner who created it, to name the
      sources and an RCO.

    A project with no processors at all reaches neither, which is why
    `creation_requirements` will not let one exist.
    """
    row = await fetch_one(
        conn,
        """SELECT
             bool_or(NOT pr.is_in_house) AS to_dco_admin,
             bool_or(pr.is_in_house)     AS to_rnd_owner
           FROM project_processor pp
           JOIN processor pr ON pr.processor_id = pp.processor_id
          WHERE pp.project_id = %s AND pp.status = 'approved'""",
        (project_id,),
    )
    return {
        "to_dco_admin": bool((row or {}).get("to_dco_admin")),
        "to_rnd_owner": bool((row or {}).get("to_rnd_owner")),
    }


# ------------------------------------------------------- facts for the machine
async def facts(conn: Conn, project_id: int) -> dict[str, Any]:
    """One query for everything the state machine needs to decide.

    Assembled here rather than in the service so a transition cannot be decided
    against facts read at three different moments.

    **Which notice the facts describe.** Not `project.current_notice_id`: that is
    set at publication, and publication now happens when the DPO approves - after
    the point where the author has to show they have a complete notice. Reading
    it there meant an author who had written one was told the project had none.

    So it resolves the notice publication *would* act on, by the same rule
    `notices.service.publish_current` uses: the newest draft if there is one,
    otherwise the newest published. The two picking differently is how a project
    passes its checks and then publishes something else.

    `notice_published` is deliberately not read off that notice. It asks whether
    anything has been served to a data principal yet - which stays true while a
    replacement sits in draft, and that is exactly when adding a site is a
    material change.
    """
    row = await fetch_one(
        conn,
        """
        SELECT
          p.project_status,
          coalesce(pp.processor_count, 0) > 0             AS has_processor,
          coalesce(length(trim(p.description)), 0) > 0    AS has_description,
          n.notice_id IS NOT NULL                         AS has_notice,
          coalesce(np.purpose_count, 0)                   AS notice_purpose_count,
          EXISTS (SELECT 1 FROM notice pub
                   WHERE pub.project_id = p.project_id
                     AND pub.status = 'published')        AS notice_published,
          n.applicable_to IS NOT NULL                     AS notice_audience_set,
          -- What the *author* writes. The approval of that text is a separate
          -- fact below, because it is a separate person's act: folding it in
          -- here meant the author could not submit until the reviewer had
          -- acted, and the reviewer does not see the project until it is
          -- submitted.
          (n.notice_id IS NOT NULL
             AND coalesce(length(trim(n.withdraw_url)), 0) > 0
             AND coalesce(length(trim(n.exercise_rights_url)), 0) > 0
             AND coalesce(length(trim(n.board_complaint_url)), 0) > 0
             AND coalesce(length(trim(n.dpo_contact)), 0) > 0
             AND coalesce(np.purpose_count, 0) >= 1) AS notice_rule3_complete,
          coalesce(nl.language_count, 0)                  AS notice_language_count,
          -- Every rendition, not merely one. A notice served in Hindi and
          -- English where only the English was approved is a data principal
          -- consenting to text nobody signed off.
          (coalesce(nl.language_count, 0) >= 1
             AND coalesce(nl.unapproved_languages, 0) = 0) AS notice_language_approved,
          coalesce(ap.proof_count, 0)                     AS approval_with_proof_count
        FROM project p
        LEFT JOIN LATERAL (
          SELECT x.notice_id, x.status, x.withdraw_url, x.exercise_rights_url,
                 x.board_complaint_url, x.dpo_contact, x.applicable_to
            FROM notice x
           WHERE x.project_id = p.project_id
           ORDER BY (x.status IN ('draft', 'approved')) DESC, x.version DESC
           LIMIT 1
        ) n ON TRUE
        LEFT JOIN LATERAL (
          SELECT count(*) AS processor_count FROM project_processor w
          WHERE w.project_id = p.project_id AND w.status = 'approved'
        ) pp ON TRUE
        LEFT JOIN LATERAL (
          SELECT count(*) AS purpose_count FROM notice_purpose x WHERE x.notice_id = n.notice_id
        ) np ON TRUE
        LEFT JOIN LATERAL (
          SELECT count(*)                                        AS language_count,
                 count(*) FILTER (WHERE y.approved_at IS NULL)   AS unapproved_languages
            FROM notice_language y
           WHERE y.notice_id = n.notice_id
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
        (
            project_id,
            approval_type,
            reference_no,
            approved_on,
            proof_file_ref,
            proof_file_hash,
            uploaded_by,
        ),
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
    pred, params = scope_predicate(role, user_id)
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
    source_id: int | None = None,
) -> Row:
    """Register a site: one data source, deployed for one project.

    The source is what routes the project. `trg_site_owner` re-derives
    `project.dco_user_id` from the primary site after this insert, and the
    primary site resolves its owner through the source - so attaching the first
    source that has an owner hands the project to them.

    Nobody names a person here, which is the point. Choosing the source *is*
    choosing the owner, so the two cannot disagree.
    """
    row = await fetch_one(
        conn,
        """
        INSERT INTO project_site (project_id, site_label, location, processor_id, source_id)
        VALUES (%s, %s, %s, %s, %s)
        RETURNING site_id, site_uuid, site_label, location, status, created_at
        """,
        (project_id, site_label, location, processor_id, source_id),
    )
    assert row is not None
    return row


async def list_sites(
    conn: Conn, project_id: int, *, role: Role | str | None = None, user_id: int | None = None
) -> list[Row]:
    """Every site on a project, or only the ones this caller may see.

    `role` is optional and its absence means *no filtering*, which is right for
    the one caller that needs it: the notice's recipient list names every place
    collection happens, and a notice that listed only the places its reader
    runs would be a notice that lied to the data principal.

    Every other caller passes a viewer.
    """
    pred, params = ("TRUE", [])
    if role is not None and user_id is not None:
        pred, params = site_scope_predicate(role, user_id)

    return await fetch_all(
        conn,
        f"""
        SELECT s.site_uuid, s.site_label, s.location, s.status, s.created_at,
               pr.processor_uuid, pr.legal_name AS processor_name, pr.is_in_house,
               ds.source_uuid, ds.source_code, ds.name AS source_name,
               -- Who actually runs this site: the override where there is one,
               -- otherwise the source's owner. Resolved in SQL rather than in
               -- the caller so every reader gets the same answer.
               dco.uuid AS dco_uuid, dco.full_name AS dco_name, dco.email AS dco_email,
               dco.role AS dco_role,
               s.dco_override_user_id IS NOT NULL AS owner_overridden,
               ovr_by.full_name AS override_by_name,
               s.dco_override_at   AS override_at,
               -- The owner this site would have on its own, so the UI can say
               -- what the exception is an exception *to*.
               src_owner.full_name AS source_owner_name,
               -- The primary site is the one whose owner the project follows.
               -- Surfaced so the UI can say which of several sites is deciding.
               (s.site_id = cmp_primary_site_id(s.project_id)) AS is_primary,
               (SELECT count(*) FROM consent_link cl
                 WHERE cl.site_id = s.site_id AND cl.status = 'active') AS active_links
        FROM project_site s
        LEFT JOIN processor pr ON pr.processor_id = s.processor_id
        LEFT JOIN data_source ds ON ds.source_id = s.source_id
        LEFT JOIN auth_user dco
               ON dco.id = coalesce(s.dco_override_user_id, ds.owner_user_id)
        LEFT JOIN auth_user src_owner ON src_owner.id = ds.owner_user_id
        LEFT JOIN auth_user ovr_by    ON ovr_by.id = s.dco_override_by
        WHERE s.project_id = %s AND ({pred})
        ORDER BY s.site_id
        """,
        [project_id, *params],
    )


async def site_by_uuid(conn: Conn, site_uuid: str, *, role: Role | str, user_id: int) -> Row | None:
    """One site, if this caller may reach it.

    Both predicates, and the site one is the point. Scoping only by project let
    a DCO who ran one campus reach every other site on the same study - and
    mint a consent link for a colleague's, or an in-house lab's. The project
    check stays because narrowing twice can only narrow.
    """
    pred, params = scope_predicate(role, user_id)
    site_pred, site_params = site_scope_predicate(role, user_id)
    return await fetch_one(
        conn,
        f"""
        SELECT s.site_id, s.site_uuid, s.site_label, s.location, s.status, s.created_at,
               p.project_id, p.project_uuid, p.project_status,
               pr.processor_uuid, pr.legal_name AS processor_name, pr.is_in_house,
               s.source_id, ds.source_uuid, ds.name AS source_name,
               coalesce(s.dco_override_user_id, ds.owner_user_id) AS dco_user_id,
               s.dco_override_user_id IS NOT NULL AS owner_overridden,
               dco.uuid AS dco_uuid, dco.full_name AS dco_name
        FROM project_site s
        JOIN project p ON p.project_id = s.project_id
        LEFT JOIN processor pr ON pr.processor_id = s.processor_id
        LEFT JOIN data_source ds ON ds.source_id = s.source_id
        LEFT JOIN auth_user dco
               ON dco.id = coalesce(s.dco_override_user_id, ds.owner_user_id)
        WHERE s.site_uuid = %s AND ({pred}) AND ({site_pred})
        """,
        [site_uuid, *params, *site_params],
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


async def primary_site_id(conn: Conn, project_id: int) -> int | None:
    """The site whose owner the project follows, or None if it has no owned site.

    Delegates to the database function rather than repeating the ORDER BY here,
    so the answer this returns and the answer the trigger acts on are the same
    answer by construction.
    """
    row = await fetch_one(conn, "SELECT cmp_primary_site_id(%s) AS site_id", (project_id,))
    return None if row is None else row["site_id"]


async def project_dco_id(conn: Conn, project_id: int) -> int | None:
    """Who currently owns this project.

    Read either side of a site reassignment so the response can say whether the
    project actually changed hands. The trigger decides; this only reports.
    """
    row = await fetch_one(
        conn, "SELECT dco_user_id FROM project WHERE project_id = %s", (project_id,)
    )
    return None if row is None else row["dco_user_id"]


async def set_site_source(conn: Conn, site_id: int, source_id: int | None) -> Row:
    """Attach a data source to a site, or detach it.

    This is how a site changes hands, and it is deliberately not a way to name a
    person: the owner comes with the source. A DCO Admin picking CIT for a site
    is choosing the source, and whoever owns CIT picks up the work.

    The project follows. `trg_site_owner` fires on this UPDATE and re-derives
    `project.dco_user_id` from whichever active site is now primary, resolving
    through the source. That is the whole mechanism behind "attach the source and
    the project moves with it" — it is in the database rather than here, so a
    second code path that reassigns a site cannot forget to do it.
    """
    row = await fetch_one(
        conn,
        """
        UPDATE project_site s
           SET source_id    = %(source)s::int,
               processor_id = d.processor_id,
               -- The label follows the source, because the site *is* that
               -- source standing somewhere. Leaving the old name would have the
               -- notice's recipient list naming a rig that is no longer there.
               -- Detaching keeps the last name rather than blanking it: the
               -- column is NOT NULL, and a site called nothing is worse than a
               -- site called what it used to be.
               site_label   = coalesce(d.name, s.site_label)
          FROM (SELECT name, processor_id, owner_user_id
                  FROM data_source WHERE source_id = %(source)s::int) d
         WHERE s.site_id = %(site)s
        RETURNING s.site_id, s.site_uuid, s.site_label, s.project_id, s.source_id,
                  d.owner_user_id AS dco_user_id
        """,
        {"source": source_id, "site": site_id},
    )
    if row is None:
        # Detaching: there is no source row to join to, so the FROM above
        # matches nothing. Done separately rather than with a LEFT JOIN LATERAL,
        # because "no source" and "source not found" want different answers and
        # one query would give them the same one.
        row = await fetch_one(
            conn,
            """
            UPDATE project_site SET source_id = NULL
             WHERE site_id = %s AND %s::int IS NULL
            RETURNING site_id, site_uuid, site_label, project_id, source_id,
                      NULL::int AS dco_user_id
            """,
            (site_id, source_id),
        )
    assert row is not None
    return row


async def set_site_owner_override(
    conn: Conn, site_id: int, owner_user_id: int | None, *, actor_id: int
) -> Row:
    """Name who runs this site on this project, or drop back to the source.

    Deliberately *not* a write to `data_source`. Reassigning the source would
    move every other project collecting from that rig, which is a decision about
    one project having consequences for several - and the person making it can
    see only the one they are looking at.

    Passing `None` clears the exception, and the site goes back to whoever owns
    its source. That is a real operation and the common way an override ends: it
    was cover, and the cover finished.

    Attribution is written in the same statement as the value, because the CHECK
    constraint refuses one without the other - an exception nobody can be asked
    about is the state the audit trail exists to prevent.
    """
    row = await fetch_one(
        conn,
        """
        UPDATE project_site s
           SET dco_override_user_id = %(owner)s::int,
               -- Cast because the parameter appears only inside a NULL test,
               -- and PostgreSQL cannot infer a type from `$1 IS NULL` alone.
               dco_override_by = CASE WHEN %(owner)s::int IS NULL THEN NULL ELSE %(actor)s::int END,
               dco_override_at = CASE WHEN %(owner)s::int IS NULL THEN NULL ELSE now() END
         WHERE s.site_id = %(site)s
        RETURNING s.site_id, s.site_uuid, s.site_label, s.project_id,
                  s.dco_override_user_id
        """,
        {"owner": owner_user_id, "actor": actor_id, "site": site_id},
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
    pred, sparams = scope_predicate(role, user_id)
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
    pred, sparams = scope_predicate(role, user_id)
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
