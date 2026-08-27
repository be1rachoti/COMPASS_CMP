"""Dashboards and notifications - 3 endpoints.

One `/dashboard` endpoint, role-aware, rather than five. The response shape
differs by role but the call does not, so the SPA has one loading path.
"""

from __future__ import annotations

from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, Query

from cmp.api.dependencies import CurrentUser
from cmp.core.errors import Forbidden, NotFound
from cmp.core.permissions import Role
from cmp.db.pool import connection, transaction
from cmp.db.repositories import audit as audit_repo
from cmp.db.repositories import entities as entity_repo
from cmp.db.repositories import projects as project_repo
from cmp.db.repositories import users as user_repo
from cmp.db.sql import fetch_all, fetch_one
from cmp.schemas.common import Acknowledged, Out

router = APIRouter(tags=["dashboard"])


class Dashboard(Out):
    role: str
    counts: dict[str, int]
    queues: list[dict[str, Any]]
    recent: list[dict[str, Any]]


@router.get("/dashboard", response_model=Dashboard, summary="Role-aware aggregate")
async def dashboard(principal: CurrentUser) -> dict[str, Any]:
    async with connection() as conn:
        match principal.role:
            case Role.RND_USER:
                return await _rnd(conn, principal.user_id)
            case Role.DPO:
                return await _dpo(conn)
            case Role.DCO | Role.RCO:
                # One dashboard. An RCO is accountable for collection the R&D
                # team does itself and a DCO for a third party's, but the work
                # in front of them - links, consents, import gaps - is the same
                # work, and two near-identical dashboards would drift.
                return await _dco(conn, principal.user_id, role=principal.role)
            case Role.DCO_ADMIN:
                return await _dco_admin(conn, principal.user_id)
            case Role.ADMIN:
                return await _admin(conn)
            case Role.DATA_SUBJECT:
                return await _subject(conn, principal.user_id)
    raise Forbidden("No dashboard for this role")


async def _recent_activity(conn: Any, *, project_ids: list[int], actor_id: int) -> list[Any]:
    """Recent activity, in the shape the audit trail uses.

    This replaced two queries that read the wrong thing. The R&D User's read
    `project` ordered by `updated_at`, and the DCO's read `export_log`: both
    said *that* something happened, neither said what or who. Somebody seeing
    their project had moved had to go elsewhere to find out who moved it.

    Now the same rows, the same resolver and the same renderer as the DPO's
    audit trail, narrowed to what the caller can reach. Their own actions are
    merged in because a project can leave their scope after they acted on it,
    and their own history should not vanish with it.
    """
    on_projects = await audit_repo.for_projects(conn, project_ids, limit=25)
    mine = await audit_repo.by_actor(conn, actor_id, limit=25)

    # Merge and de-duplicate: an action on your own project appears in both.
    seen: set[str] = set()
    merged = []
    for row in sorted([*on_projects, *mine], key=lambda r: r["occurred_at"], reverse=True):
        key = str(row["log_uuid"])
        if key in seen:
            continue
        seen.add(key)
        merged.append(row)

    # The same resolver the audit trail uses, so "Notice published" carries the
    # notice it was about rather than `notice#42`.
    return await entity_repo.attach(conn, merged[:15])


async def _rnd(conn: Any, user_id: int) -> dict[str, Any]:
    """Own projects by status; what needs their action."""
    counts = await fetch_one(
        conn,
        """SELECT
             count(*) AS total,
             count(*) FILTER (WHERE project_status IN ('in_draft', 'under_process'))
                                                                         AS in_draft,
             count(*) FILTER (WHERE project_status = 'pending_approval') AS pending_approval,
             count(*) FILTER (WHERE project_status = 'approved')         AS approved,
             count(*) FILTER (WHERE project_status = 'closed')           AS closed
           FROM project WHERE created_by = %s""",
        (user_id,),
    )
    # A draft with no proof-bearing approval is precisely what they must act on:
    # it is the last requirement between them and submitting for review, and the
    # one most easily forgotten because the proof comes from somebody else.
    queue = await fetch_all(
        conn,
        """SELECT p.project_uuid, p.project_name, p.project_status, p.updated_at,
                  'Upload a security approval with its proof file' AS action
           FROM project p
           WHERE p.created_by = %s
             AND p.project_status IN ('in_draft', 'under_process')
             AND NOT EXISTS (
               SELECT 1 FROM project_approval a
               WHERE a.project_id = p.project_id
                 AND coalesce(length(trim(a.proof_file_ref)), 0) > 0)
           ORDER BY p.updated_at DESC LIMIT 25""",
        (user_id,),
    )
    own_projects = await fetch_all(
        conn, "SELECT project_id FROM project WHERE created_by = %s", (user_id,)
    )
    recent = await _recent_activity(
        conn, project_ids=[r["project_id"] for r in own_projects], actor_id=user_id
    )
    return {
        "role": "rnd_user",
        "counts": _ints(counts),
        "queues": [{"name": "Needs your action", "items": queue}],
        "recent": recent,
    }


async def _dpo(conn: Any) -> dict[str, Any]:
    counts = await fetch_one(
        conn,
        """SELECT
             (SELECT count(*) FROM project WHERE project_status = 'in_draft')
               AS in_draft,
             (SELECT count(*) FROM project WHERE project_status = 'pending_approval')
               AS pending_approval,
             (SELECT count(*) FROM project WHERE project_status = 'approved')
               AS approved,
             (SELECT count(*) FROM notice WHERE status = 'draft')      AS draft_notices,
             (SELECT count(*) FROM purpose WHERE status = 'draft')     AS draft_purposes,
             (SELECT count(*) FROM v_current_consent)                  AS total_consents,
             (SELECT count(*) FROM v_current_consent WHERE is_withdrawal)
               AS withdrawals,
             (SELECT count(*) FROM notice_language WHERE approved_at IS NULL)
               AS unapproved_languages""",
    )
    draft_queue = await fetch_all(
        conn,
        """SELECT p.project_uuid, p.project_name, p.updated_at,
                  'Review and publish the notice' AS action
           FROM project p WHERE p.project_status = 'in_draft'
           ORDER BY p.updated_at DESC LIMIT 25""",
    )
    approval_queue = await fetch_all(
        conn,
        """SELECT p.project_uuid, p.project_name, p.updated_at,
                  'Review the approval documents' AS action
           FROM project p WHERE p.project_status = 'pending_approval'
           ORDER BY p.updated_at DESC LIMIT 25""",
    )
    # Amendments to projects the DPO has already approved. Its own queue rather
    # than a row in the approval one: those are projects waiting to start, this
    # is a live project waiting to expand, and the second is easy to leave
    # sitting because nothing about it looks stalled.
    amendments = await project_repo.pending_processor_requests(conn)
    denials = await audit_repo.denial_counts(conn, days=7)
    # Full audit rows, resolved, so the dashboard panel and the audit page are
    # the same renderer over the same data. The partial projection this replaced
    # could not carry an entity reference, which is the half that says *what*
    # was published rather than only that something was.
    recent = await entity_repo.attach(conn, await audit_repo.recent(conn, limit=15))
    return {
        "role": "dpo",
        "counts": {
            **_ints(counts),
            "access_denials_7d": denials,
            "pending_processors": len(amendments),
        },
        "queues": [
            {"name": "In Draft", "items": draft_queue},
            {"name": "Pending Approval", "items": approval_queue},
            {"name": "New collectors awaiting your decision", "items": amendments},
        ],
        "recent": recent,
    }


async def _dco(conn: Any, user_id: int, *, role: Role = Role.DCO) -> dict[str, Any]:
    counts = await fetch_one(
        conn,
        """SELECT
             (SELECT count(*) FROM project WHERE dco_user_id = %(u)s
                AND project_status = 'approved')                       AS approved_projects,
             (SELECT count(*) FROM consent_link cl
                JOIN notice n ON n.notice_id = cl.notice_id
                JOIN project p ON p.project_id = n.project_id
               WHERE p.dco_user_id = %(u)s AND cl.status = 'active')    AS active_links,
             (SELECT count(*) FROM v_current_consent vc
                JOIN notice n ON n.notice_id = vc.notice_id
                JOIN project p ON p.project_id = n.project_id
               WHERE p.dco_user_id = %(u)s)                            AS consents,
             (SELECT count(*) FROM export_log e
                JOIN project p ON p.project_id = e.project_id
               WHERE p.dco_user_id = %(u)s)                            AS exports,
             (SELECT count(*) FROM data_asset a
                JOIN collection c ON c.collection_id = a.collection_id
                JOIN project p ON p.project_id = c.project_id
               WHERE p.dco_user_id = %(u)s AND a.has_unmapped_subjects) AS flagged_assets""",
        {"u": user_id},
    )
    # Declared-against-mapped gaps: the control that makes direct collection workable.
    exceptions = await fetch_all(
        conn,
        """SELECT c.collection_uuid, c.source_collection_ref, c.collected_on,
                  c.declared_asset_count,
                  (SELECT count(*) FROM data_asset a
                    WHERE a.collection_id = c.collection_id) AS mapped_asset_count,
                  p.project_uuid, p.project_name
           FROM collection c JOIN project p ON p.project_id = c.project_id
           WHERE p.dco_user_id = %s
             AND c.declared_asset_count >
                 (SELECT count(*) FROM data_asset a WHERE a.collection_id = c.collection_id)
           ORDER BY c.collected_on DESC LIMIT 25""",
        (user_id,),
    )
    # Projects in this caller's *read* scope. The predicate is imported rather
    # than restated: it used to be copied here under a comment promising the
    # feed and the project list could not show different worlds, and a copy is
    # exactly how they come to.
    pred, pred_params = project_repo.scope_predicate(role, user_id)
    in_scope = await fetch_all(
        conn, f"SELECT p.project_id FROM project p WHERE {pred}", pred_params
    )
    recent = await _recent_activity(
        conn, project_ids=[r["project_id"] for r in in_scope], actor_id=user_id
    )
    return {
        "role": str(role),
        "counts": _ints(counts),
        "queues": [{"name": "Import exceptions", "items": exceptions}],
        "recent": recent,
    }


async def _dco_admin(conn: Any, user_id: int) -> dict[str, Any]:
    """The routing queue.

    A DCO Admin's job has one shape: approved projects collected by a third party
    whose sites have no data source attached yet. Until one is, no consent link
    can be minted for that site and nobody is accountable for it - the project is
    approved and stalled, and nothing else in the system says so.
    """
    counts = await fetch_one(
        conn,
        """SELECT
             count(DISTINCT p.project_id)                                AS projects,
             count(DISTINCT p.project_id) FILTER (
               WHERE p.project_status = 'approved')                      AS approved_projects,
             count(DISTINCT ps.site_id) FILTER (
               WHERE ps.source_id IS NULL AND ps.status = 'active')      AS sites_awaiting_source,
             (SELECT count(*) FROM data_source d
                JOIN processor pr ON pr.processor_id = d.processor_id
               WHERE NOT pr.is_in_house
                 AND d.owner_user_id IS NULL
                 AND d.status = 'active')                                AS sources_without_owner
           FROM project p
           JOIN project_processor pp ON pp.project_id = p.project_id
           JOIN processor pr ON pr.processor_id = pp.processor_id
           LEFT JOIN project_site ps ON ps.project_id = p.project_id
          WHERE NOT pr.is_in_house""",
    )
    awaiting = await fetch_all(
        conn,
        """SELECT DISTINCT p.project_uuid, p.project_name, p.project_status, p.updated_at,
                  ps.site_uuid, ps.site_label,
                  'Attach the data source that will collect here' AS action
           FROM project p
           JOIN project_processor pp ON pp.project_id = p.project_id
           JOIN processor pr ON pr.processor_id = pp.processor_id
           JOIN project_site ps ON ps.project_id = p.project_id
          WHERE NOT pr.is_in_house
            AND p.project_status = 'approved'
            AND ps.status = 'active'
            AND ps.source_id IS NULL
          ORDER BY p.updated_at DESC LIMIT 25""",
    )

    # A processor the DPO has just agreed to, with no collection set up under it
    # yet. The site queue above cannot show this - there are no sites to show -
    # so without it a newly approved partner is invisible to the person whose
    # job is to set it up.
    fresh = await fetch_all(
        conn,
        """SELECT p.project_uuid, p.project_name, p.project_status,
                  pr.legal_name, pp.decided_at,
                  'Register the collection sites for this new processor' AS action
           FROM project_processor pp
           JOIN project p    ON p.project_id = pp.project_id
           JOIN processor pr ON pr.processor_id = pp.processor_id
          WHERE pp.status = 'approved'
            AND NOT pr.is_in_house
            AND p.project_status = 'approved'
            AND NOT EXISTS (SELECT 1 FROM project_site ps
                             WHERE ps.project_id = pp.project_id
                               AND ps.processor_id = pp.processor_id
                               AND ps.status = 'active')
          ORDER BY pp.decided_at DESC NULLS LAST
          LIMIT 25""",
    )

    pred, pred_params = project_repo.scope_predicate(Role.DCO_ADMIN, user_id)
    in_scope = await fetch_all(
        conn, f"SELECT p.project_id FROM project p WHERE {pred}", pred_params
    )
    recent = await _recent_activity(
        conn, project_ids=[r["project_id"] for r in in_scope], actor_id=user_id
    )
    return {
        "role": "dco_admin",
        "counts": _ints(counts),
        "queues": [
            {"name": "Processors with no collection set up", "items": fresh},
            {"name": "Sites awaiting a data source", "items": awaiting},
        ],
        "recent": recent,
    }


async def _admin(conn: Any) -> dict[str, Any]:
    by_status = await user_repo.count_by_status(conn)
    by_role = await user_repo.count_by_role(conn)
    suspended = await fetch_all(
        conn,
        """SELECT source_uuid, source_code, name, status FROM data_source
           WHERE status <> 'active'
           UNION ALL
           SELECT processor_uuid, contract_ref, legal_name, status FROM processor
           WHERE status <> 'active'
           LIMIT 50""",
    )
    # An administrator's "recent" is refusals, not activity: they provision
    # accounts rather than run collections, and a denial is the signal they act
    # on. Same shape as every other role's, so one renderer serves all five.
    denials = await entity_repo.attach(
        conn, await audit_repo.recent(conn, limit=25, event_type="auth.access_denied")
    )
    lockouts = await fetch_all(
        conn,
        """SELECT l.occurred_at, u.full_name, u.email
           FROM audit_log l JOIN auth_user u ON u.id = l.subject_user_id
           WHERE l.event_type = 'auth.login_locked_out'
             AND l.occurred_at > now() - interval '24 hours'
           ORDER BY l.occurred_at DESC LIMIT 25""",
    )
    return {
        "role": "admin",
        "counts": {
            **{f"users_{k}": v for k, v in by_status.items()},
            **{f"role_{k}": v for k, v in by_role.items()},
            "suspended_registry_rows": len(suspended),
        },
        "queues": [
            {"name": "Lockouts (24h)", "items": lockouts},
            {"name": "Suspended sources and processors", "items": suspended},
        ],
        "recent": denials,
    }


async def _subject(conn: Any, user_id: int) -> dict[str, Any]:
    counts = await fetch_one(
        conn,
        """WITH mine AS (
             SELECT vc.consent_id, vc.is_withdrawal,
                    count(*) FILTER (WHERE g.granted) AS granted
             FROM v_current_consent vc
             LEFT JOIN consent_purpose_grant g ON g.consent_id = vc.consent_id
             WHERE vc.auth_user_id = %(u)s
             GROUP BY vc.consent_id, vc.is_withdrawal)
           SELECT count(*) AS total,
                  count(*) FILTER (WHERE NOT is_withdrawal AND granted > 0) AS active,
                  count(*) FILTER (WHERE is_withdrawal)                     AS withdrawn,
                  count(*) FILTER (WHERE NOT is_withdrawal AND granted = 0) AS declined,
                  (SELECT count(*) FROM export_line WHERE auth_user_id = %(u)s)
                    AS times_shared
           FROM mine""",
        {"u": user_id},
    )
    recent = await audit_repo.for_subject(conn, user_id, limit=10)
    return {"role": "data_subject", "counts": _ints(counts), "queues": [], "recent": recent}


def _ints(row: dict[str, Any] | None) -> dict[str, int]:
    return {k: int(v or 0) for k, v in (row or {}).items()}


@router.get("/notifications")
async def notifications(
    principal: CurrentUser,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
) -> dict[str, Any]:
    """Derived from the audit trail rather than a separate table.

    There is no notifications table among the 22, and deriving the feed means it
    can never disagree with the record it is describing.
    """
    async with connection() as conn:
        if principal.role is Role.DATA_SUBJECT:
            rows = await audit_repo.for_subject(conn, principal.user_id, limit=limit)
        else:
            rows = await fetch_all(
                conn,
                """SELECT l.log_uuid, l.event_type, l.entity_type, l.entity_id,
                          l.occurred_at, l.detail_json - '_hash' - '_prev' AS detail,
                          a.full_name AS actor_name
                   FROM audit_log l LEFT JOIN auth_user a ON a.id = l.actor_user_id
                   WHERE l.event_type IN (
                     'project.transitioned','notice.published','import.rejected',
                     'export.generated','consent.withdrawn','auth.login_locked_out')
                   ORDER BY l.occurred_at DESC LIMIT %s""",
                (limit,),
            )
        # Same resolution the audit trail gets: a notification that says
        # "notice#42 published" tells the reader nothing they can act on.
        #
        # Resolved to the reader's own pages. A data principal's feed is all
        # events about herself, and every one of them used to link into a staff
        # console - `auth_user` to the administrator's account register, which
        # is where following her own registration notification took her.
        rows = await entity_repo.attach(
            conn, rows, for_subject=principal.role is Role.DATA_SUBJECT
        )
    return {"items": rows, "next_cursor": None, "total": len(rows)}


@router.post("/notifications/{log_uuid}/resend", response_model=Acknowledged)
async def resend(log_uuid: UUID, principal: CurrentUser) -> dict[str, Any]:
    """Re-deliver a failed notification.

    Restricted to DPO and DCO: re-sending a consent receipt puts a message in
    somebody's inbox, and that is not an action a general user should be able to
    trigger for an arbitrary event.
    """
    if principal.role not in (Role.DPO, Role.DCO):
        raise Forbidden("Your role may not resend notifications")

    async with transaction() as conn:
        entry = await audit_repo.by_uuid(conn, str(log_uuid))
        if not entry:
            raise NotFound("Notification")

        if not entry.get("subject_uuid"):
            raise NotFound("Notification recipient")

        from cmp.db.sql import fetch_one as _fetch_one

        subject = await _fetch_one(
            conn,
            "SELECT id, email, full_name FROM auth_user WHERE uuid = %s",
            (str(entry["subject_uuid"]),),
        )
        if not subject:
            raise NotFound("Notification recipient")

    from cmp.tasks.dispatch import dispatch_required
    from cmp.tasks.notifications.batch import notify_project_event

    dispatch_required(
        notify_project_event,
        [subject["email"]],
        "A message from the Privacy Office",
        f"Regarding {entry['event_type']} on {entry['occurred_at']:%d %B %Y}.",
    )
    return {"ok": True, "message": "Queued for delivery."}
