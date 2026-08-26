"""Project lifecycle service.

The only place project rows are written. Every transition passes through
`state_machine.validate`, records a history row, and writes an audit row - in one
transaction, so a project can never be in a state its history does not explain.
"""

from __future__ import annotations

from typing import Any

from cmp.core.errors import Conflict, Forbidden, NotFound, ValidationFailed
from cmp.core.logging import get_logger
from cmp.core.permissions import Role
from cmp.db.repositories import projects as repo
from cmp.db.repositories import users as user_repo
from cmp.db.sql import Conn
from cmp.domain.audit import service as audit
from cmp.domain.audit.service import Event
from cmp.domain.projects.state_machine import (
    ProjectFacts,
    ProjectStatus,
    available,
    creation_requirements,
    validate,
)

log = get_logger("cmp.projects")


async def _facts(conn: Conn, project_id: int) -> ProjectFacts:
    raw = await repo.facts(conn, project_id)
    return ProjectFacts(
        has_notice=bool(raw.get("has_notice")),
        notice_purpose_count=int(raw.get("notice_purpose_count") or 0),
        notice_rule3_complete=bool(raw.get("notice_rule3_complete")),
        notice_published=bool(raw.get("notice_published")),
        approval_with_proof_count=int(raw.get("approval_with_proof_count") or 0),
        has_dco=bool(raw.get("has_dco")),
        has_description=bool(raw.get("has_description")),
        # A DPO reaching pending_approval -> approved *is* the review. The act of
        # calling the transition with the DPO role records it.
        review_recorded=True,
    )


async def create(
    conn: Conn,
    *,
    actor_id: int,
    project_name: str,
    description: str,
    dco_user_uuid: str,
    internal_project_name: str | None = None,
    requesting_team: str | None = None,
) -> dict[str, Any]:
    missing = creation_requirements(
        name=project_name, description=description, dco_user_uuid=dco_user_uuid
    )
    if missing:
        raise ValidationFailed("; ".join(missing), code="project_incomplete")

    dco = await user_repo.by_uuid(conn, dco_user_uuid)
    if not dco:
        raise ValidationFailed("Nominated DCO not found", field="dco_user_uuid")
    if dco["role"] != Role.DCO.value:
        raise ValidationFailed(
            "The nominated user is not a Data Collection Owner", field="dco_user_uuid"
        )
    if dco["status"] != "active":
        raise ValidationFailed("The nominated DCO is not active", field="dco_user_uuid")

    project = await repo.create(
        conn,
        project_name=project_name,
        description=description,
        internal_project_name=internal_project_name,
        requesting_team=requesting_team,
        created_by=actor_id,
        dco_user_id=dco["id"],
    )
    await repo.record_transition(
        conn,
        project_id=project["project_id"],
        from_status=None,
        to_status=ProjectStatus.IN_DRAFT.value,
        reason=None,
        actor_user_id=actor_id,
    )
    await audit.record(
        conn,
        event=Event.PROJECT_CREATED,
        entity_type="project",
        entity_id=project["project_id"],
        detail={"project_name": project_name, "dco": dco_user_uuid},
    )
    return project


async def update_draft(
    conn: Conn, *, project_uuid: str, actor_id: int, role: Role | str, **fields: Any
) -> dict[str, Any]:
    project = await repo.require(conn, project_uuid, role=role, user_id=actor_id, write=True)
    locked = await repo.require_for_update(conn, project["project_id"])

    if locked["project_status"] != ProjectStatus.IN_DRAFT.value:
        raise Conflict(
            "Only a project in draft may be edited",
            code="project_not_editable",
            details={"status": locked["project_status"]},
        )
    if locked["created_by"] != actor_id and Role(role) is Role.RND_USER:
        raise Forbidden("You may only edit projects you created")

    updated = await repo.update_draft(conn, project["project_id"], **fields)
    await audit.record(
        conn,
        event=Event.PROJECT_UPDATED,
        entity_type="project",
        entity_id=project["project_id"],
        detail={"fields": sorted(k for k, v in fields.items() if v is not None)},
    )
    return updated


async def transitions_for(
    conn: Conn, *, project_uuid: str, role: Role | str, user_id: int
) -> dict[str, Any]:
    project = await repo.require(conn, project_uuid, role=role, user_id=user_id)
    facts = await _facts(conn, project["project_id"])
    return {
        "current": project["project_status"],
        "available": available(project["project_status"], role, facts),
    }


async def transition(
    conn: Conn,
    *,
    project_uuid: str,
    target: str,
    role: Role | str,
    actor_id: int,
    reason: str | None = None,
) -> dict[str, Any]:
    """Move a project. The single write path for `project.project_status`."""
    project = await repo.require(conn, project_uuid, role=role, user_id=actor_id, write=True)
    locked = await repo.require_for_update(conn, project["project_id"])
    current = locked["project_status"]

    facts = await _facts(conn, project["project_id"])
    permitted = validate(current=current, target=target, role=role, facts=facts, reason=reason)

    # Publication is a side effect of in_draft -> under_process, and it happens in
    # this transaction. A project that moved without its notice publishing would
    # be collecting against text nobody froze.
    published_notice = None
    if permitted.publishes_notice:
        from cmp.domain.notices import service as notice_service

        published_notice = await notice_service.publish_current(
            conn, project_id=project["project_id"], actor_id=actor_id
        )

    await repo.set_status(conn, project["project_id"], permitted.to.value)
    history = await repo.record_transition(
        conn,
        project_id=project["project_id"],
        from_status=current,
        to_status=permitted.to.value,
        reason=reason,
        actor_user_id=actor_id,
    )
    await audit.record(
        conn,
        event=Event.PROJECT_TRANSITIONED,
        entity_type="project",
        entity_id=project["project_id"],
        detail={
            "from": current,
            "to": permitted.to.value,
            "reason": reason,
            "published_notice": str(published_notice["notice_uuid"]) if published_notice else None,
        },
    )
    log.info(
        "project.transitioned",
        project=project_uuid,
        **{"from": current, "to": permitted.to.value},
    )
    return {
        "project_uuid": project_uuid,
        "from": current,
        "to": permitted.to.value,
        "occurred_at": history["occurred_at"],
        "published_notice_uuid": published_notice["notice_uuid"] if published_notice else None,
    }


async def assign_dco(
    conn: Conn, *, project_uuid: str, dco_user_uuid: str, actor_id: int, role: Role | str
) -> dict[str, Any]:
    """Nominate the DCO for a project.

    Since site ownership arrived, `project.dco_user_id` is *derived* from the
    primary site by `trg_site_owner` — so writing it directly would produce an
    assignment that survives only until the next time any site on the project
    changed, at which point it would silently revert. That is the worst kind of
    bug: correct on the screen that made it, wrong later, with nothing to point
    at.

    So this assigns the *site*, and lets the trigger route the project:

    * **Project has sites** — the primary one is handed to this DCO, which moves
      the project. Sites owned by other DCOs are left alone; they keep their
      read access and their own sites.
    * **Project has no sites yet** — there is nothing to derive from, so the
      column is set directly. The first site to arrive with an owner takes over,
      which is correct under this model and is why the response says so.
    """
    project = await repo.require(conn, project_uuid, role=role, user_id=actor_id, write=True)
    dco = await user_repo.by_uuid(conn, dco_user_uuid)
    if not dco or dco["role"] != Role.DCO.value:
        raise ValidationFailed("That user is not a Data Collection Owner", field="dco_user_uuid")
    if dco["status"] != "active":
        raise ValidationFailed("That Data Collection Owner is not active", field="dco_user_uuid")

    primary_site_id = await repo.primary_site_id(conn, project["project_id"])
    if primary_site_id is not None:
        await repo.set_site_dco(conn, primary_site_id, dco["id"])
    else:
        await repo.set_dco(conn, project["project_id"], dco["id"])

    await audit.record(
        conn,
        event=Event.PROJECT_DCO_ASSIGNED,
        entity_type="project",
        entity_id=project["project_id"],
        subject_user_id=dco["id"],
        detail={"dco": dco_user_uuid, "via_site": primary_site_id is not None},
    )
    return {
        "project_uuid": project_uuid,
        "dco_uuid": dco_user_uuid,
        "assigned_via_site": primary_site_id is not None,
    }


async def close(
    conn: Conn, *, project_uuid: str, actor_id: int, role: Role | str, reason: str | None
) -> dict[str, Any]:
    """Close a project and revoke its live links in the same transaction.

    A closed project whose consent links still resolve is a project that keeps
    collecting after the population was told it had ended.
    """
    result = await transition(
        conn,
        project_uuid=project_uuid,
        target=ProjectStatus.CLOSED.value,
        role=role,
        actor_id=actor_id,
        reason=reason,
    )
    from cmp.db.repositories import consent as consent_repo

    revoked = await consent_repo.revoke_links_for_project(
        conn, project_uuid=project_uuid, actor_id=actor_id
    )
    await audit.record(
        conn,
        event=Event.PROJECT_CLOSED,
        entity_type="project",
        entity_id=(await repo.require(conn, project_uuid, role=role, user_id=actor_id, write=True))[
            "project_id"
        ],
        detail={"links_revoked": revoked, "reason": reason},
    )
    return {**result, "links_revoked": revoked}


# ---------------------------------------------------------------- approvals
async def add_approval(
    conn: Conn,
    *,
    project_uuid: str,
    actor_id: int,
    role: Role | str,
    approval_type: str,
    reference_no: str,
    approved_on: Any,
    proof_file_ref: str,
    proof_file_hash: str,
) -> dict[str, Any]:
    """INV-8: proof is mandatory, enforced here and by NOT NULL in the schema."""
    project = await repo.require(conn, project_uuid, role=role, user_id=actor_id, write=True)
    if not proof_file_ref or not proof_file_hash:
        raise ValidationFailed("A proof file is mandatory", field="proof")

    if project["project_status"] not in (
        ProjectStatus.UNDER_PROCESS.value,
        ProjectStatus.PENDING_APPROVAL.value,
    ):
        raise Conflict(
            "Approvals may only be added while the project is under process",
            code="approval_wrong_state",
            details={"status": project["project_status"]},
        )

    approval = await repo.add_approval(
        conn,
        project_id=project["project_id"],
        approval_type=approval_type,
        reference_no=reference_no,
        approved_on=approved_on,
        proof_file_ref=proof_file_ref,
        proof_file_hash=proof_file_hash,
        uploaded_by=actor_id,
    )
    await audit.record(
        conn,
        event=Event.APPROVAL_UPLOADED,
        entity_type="project_approval",
        entity_id=approval["approval_id"],
        detail={
            "project": project_uuid,
            "approval_type": approval_type,
            "reference_no": reference_no,
            "proof_sha256": proof_file_hash,
        },
    )
    return approval


# -------------------------------------------------------------------- sites
async def add_site(
    conn: Conn,
    *,
    project_uuid: str,
    actor_id: int,
    role: Role | str,
    site_label: str,
    location: str | None,
    processor_uuid: str | None,
    source_uuid: str | None = None,
    dco_user_uuid: str | None = None,
) -> dict[str, Any]:
    """Adding a site is a material change.

    It adds a recipient to the notice, so it requires a new notice version. The
    service flags it; the DPO decides. What it must not do is quietly change who
    the data goes to while the published notice still names the old list.

    `dco_user_uuid` is who will be accountable for it. Where this is the
    project's first owned site, `trg_site_owner` routes the project to them on
    commit - which is how a project reaches a DCO without anybody nominating one
    on the project itself.

    `source_uuid` binds the data source that will feed this site. It is optional
    because a site can be registered before anyone has decided which rig will
    stand in it, but where it is given the source must belong to the same
    processor - a source operated by one processor cannot report from a site
    operated by another without one of the two being wrong.
    """
    from cmp.db.repositories import registry as registry_repo

    project = await repo.require(conn, project_uuid, role=role, user_id=actor_id, write=True)

    processor_id = None
    if processor_uuid:
        processor = await registry_repo.processor_by_uuid(conn, processor_uuid)
        if not processor:
            raise NotFound("Processor")
        if processor["status"] != "active":
            raise ValidationFailed("That processor is not active", field="processor_uuid")
        processor_id = processor["processor_id"]

    source = None
    if source_uuid:
        source = await registry_repo.source_by_uuid(conn, source_uuid)
        if not source:
            raise NotFound("Data source")
        if source["status"] != "active":
            raise ValidationFailed("That data source is not active", field="source_uuid")
        # Compared on the public uuid rather than the surrogate key: the same
        # check, without needing the internal id in a second query's projection.
        bound_to = source.get("processor_uuid")
        if processor_uuid and bound_to and str(bound_to) != str(processor_uuid):
            raise ValidationFailed(
                "That data source belongs to a different processor", field="source_uuid"
            )

    dco_id = None
    if dco_user_uuid:
        from cmp.db.repositories import users as users_repo

        dco = await users_repo.by_uuid(conn, dco_user_uuid)
        if not dco or dco["role"] != Role.DCO or dco["status"] != "active":
            raise ValidationFailed(
                "That is not an active Data Collection Owner", field="dco_user_uuid"
            )
        dco_id = dco["id"]

    site = await repo.add_site(
        conn,
        project_id=project["project_id"],
        site_label=site_label,
        location=location,
        processor_id=processor_id,
        dco_user_id=dco_id,
    )

    if source is not None:
        await registry_repo.bind_source_to_site(
            conn, source_id=source["source_id"], site_id=site["site_id"]
        )

    facts = await repo.facts(conn, project["project_id"])
    material = bool(facts.get("notice_published"))

    await audit.record(
        conn,
        event=Event.SITE_CREATED,
        entity_type="project_site",
        entity_id=site["site_id"],
        detail={"project": project_uuid, "site_label": site_label, "material_change": material},
    )
    return {
        **site,
        "material_change": material,
        "notice": (
            "This site is a new recipient. The published notice names the previous "
            "list, so a new notice version is required before collecting here."
            if material
            else None
        ),
    }
