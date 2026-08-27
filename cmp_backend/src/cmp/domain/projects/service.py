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
from cmp.db.repositories import registry as registry_repo
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
        notice_audience_set=bool(raw.get("notice_audience_set")),
        notice_language_count=int(raw.get("notice_language_count") or 0),
        notice_language_approved=bool(raw.get("notice_language_approved")),
        notice_published=bool(raw.get("notice_published")),
        approval_with_proof_count=int(raw.get("approval_with_proof_count") or 0),
        has_processor=bool(raw.get("has_processor")),
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
    processor_uuids: list[str],
    internal_project_name: str | None = None,
    requesting_team: str | None = None,
) -> dict[str, Any]:
    """Open a project in draft.

    Who will collect is the first decision, so it is the one asked here. A DCO
    used to be nominated at this point and no longer is: which person is
    accountable follows from the data sources chosen under the processor, and
    those do not exist yet. An R&D User naming a DCO on day one was answering on
    behalf of a decision nobody had taken - and the answer then had to survive
    until somebody noticed it was wrong.
    """
    missing = creation_requirements(
        name=project_name,
        description=description,
        processor_count=len(processor_uuids),
    )
    if missing:
        raise ValidationFailed("; ".join(missing), code="project_incomplete")

    processors = []
    for uuid in processor_uuids:
        row = await registry_repo.processor_by_uuid(conn, uuid)
        if not row:
            raise ValidationFailed(f"Processor {uuid} not found", field="processor_uuids")
        if row["status"] != "active":
            # A suspended processor is one the organisation has stopped
            # collecting through. Starting a project against it would be
            # scheduling collection that must not happen.
            raise ValidationFailed(
                f"{row['legal_name']} is {row['status']} and cannot take new projects",
                field="processor_uuids",
            )
        processors.append(row)

    project = await repo.create(
        conn,
        project_name=project_name,
        description=description,
        internal_project_name=internal_project_name,
        requesting_team=requesting_team,
        created_by=actor_id,
        dco_user_id=None,
    )
    await repo.set_processors(
        conn,
        project["project_id"],
        [r["processor_id"] for r in processors],
        actor_id=actor_id,
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
        detail={
            "project_name": project_name,
            "processors": [r["legal_name"] for r in processors],
        },
    )
    project["processors"] = await repo.processors_for(conn, project["project_id"])
    return project


async def request_processor(
    conn: Conn,
    *,
    project_uuid: str,
    processor_uuid: str,
    actor_id: int,
    role: Role | str,
) -> dict[str, Any]:
    """Add a collector to a project, or ask the DPO to let you.

    Which of the two it is depends on where the project is, and the caller does
    not choose:

    * **In draft** it is simply added. The DPO reviews the whole project at
      approval, and everything on it with it, so a separate decision here would
      be the same decision asked twice.
    * **Approved** it is a request. Collection is already live under the
      processors the DPO agreed to, and adding another means collecting through
      an organisation they have not seen - which is the thing the approval was
      for. So the processor goes on the list marked pending and counts for
      nothing until they answer: no site may deploy its sources, and the routing
      does not see it.

    Deliberately *not* a return of the whole project to review. The existing
    sites are collecting, consent is being taken at them, and suspending all of
    that to add somewhere else would punish the parts nobody questioned.
    """
    project = await repo.require(conn, project_uuid, role=role, user_id=actor_id, write=True)
    locked = await repo.require_for_update(conn, project["project_id"])
    status = locked["project_status"]

    if status in (ProjectStatus.CLOSED.value,):
        raise Conflict(
            "A closed project takes no new collectors",
            code="project_closed",
            details={"status": status},
        )

    processor = await registry_repo.processor_by_uuid(conn, processor_uuid)
    if not processor:
        raise NotFound("Processor")
    if processor["status"] != "active":
        raise ValidationFailed(
            f"{processor['legal_name']} is {processor['status']} and cannot take new projects",
            field="processor_uuid",
        )

    # Anything past draft needs the DPO's agreement. `pending_approval` counts
    # as past it: the DPO is looking at the project right now, and slipping a
    # collector in underneath that review would change what they are approving.
    needs_decision = status != ProjectStatus.IN_DRAFT.value

    await repo.request_processor(
        conn,
        project["project_id"],
        processor["processor_id"],
        actor_id=actor_id,
        pending=needs_decision,
    )
    await audit.record(
        conn,
        event=Event.PROCESSOR_REQUESTED if needs_decision else Event.PROJECT_UPDATED,
        entity_type="project",
        entity_id=project["project_id"],
        detail={
            "processor": processor["legal_name"],
            "project_status": status,
            "awaiting_dpo": needs_decision,
        },
    )
    return {
        "project_uuid": project_uuid,
        "processor_uuid": processor_uuid,
        "status": "pending" if needs_decision else "approved",
        "message": (
            f"{processor['legal_name']} has been sent to the DPO. Nothing can collect "
            "under it until they agree."
            if needs_decision
            else f"{processor['legal_name']} added."
        ),
    }


async def decide_processor(
    conn: Conn,
    *,
    project_uuid: str,
    processor_uuid: str,
    approved: bool,
    reason: str | None,
    actor_id: int,
    role: Role | str,
) -> dict[str, Any]:
    """The DPO's answer on one requested collector.

    A refusal needs a reason, and the database holds it to that as well: "no"
    with nothing after it is a decision the R&D User cannot act on, so they ask
    again and get it again.

    Approving does not move the project. It makes the processor real - its
    sources become deployable - and the work then appears where it belongs: a
    third party's on the DCO Admin's queue, an in-house one back with the R&D
    owner. Neither needs the project's status to change, because nothing about
    the project changed; something was added to it.
    """
    project = await repo.require(conn, project_uuid, role=role, user_id=actor_id, write=True)
    processor = await registry_repo.processor_by_uuid(conn, processor_uuid)
    if not processor:
        raise NotFound("Processor")

    if not approved and not (reason or "").strip():
        raise ValidationFailed(
            "Say why. A refusal with no reason is one the R&D User cannot act on",
            field="reason",
        )

    decided = await repo.decide_processor(
        conn,
        project["project_id"],
        processor["processor_id"],
        approved=approved,
        actor_id=actor_id,
        reason=(reason or "").strip() or None,
    )
    if decided is None:
        raise Conflict(
            "There is no pending request for that processor on this project",
            code="no_pending_request",
        )

    await audit.record(
        conn,
        event=Event.PROCESSOR_APPROVED if approved else Event.PROCESSOR_REJECTED,
        entity_type="project",
        entity_id=project["project_id"],
        detail={
            "processor": processor["legal_name"],
            "reason": reason,
            "in_house": bool(processor["is_in_house"]),
        },
    )
    return {
        "project_uuid": project_uuid,
        "processor_uuid": processor_uuid,
        "status": decided["status"],
        "message": (
            (
                f"{processor['legal_name']} approved. It goes to the R&D owner to name "
                "the data sources and an RCO."
                if processor["is_in_house"]
                else f"{processor['legal_name']} approved. It goes to the DCO Admin to "
                "have its data sources assigned."
            )
            if approved
            else f"{processor['legal_name']} refused. Nothing will collect under it."
        ),
    }


async def set_processors(
    conn: Conn, *, project_uuid: str, processor_uuids: list[str], actor_id: int, role: Role | str
) -> list[dict[str, Any]]:
    """Change who will collect, while the project is still in draft.

    Locked once it leaves draft. The processors are what the DPO reviewed and
    what the routing was decided from; changing them afterwards would re-point an
    approved project at a collector nobody approved.
    """
    project = await repo.require(conn, project_uuid, role=role, user_id=actor_id, write=True)
    locked = await repo.require_for_update(conn, project["project_id"])
    if locked["project_status"] != ProjectStatus.IN_DRAFT.value:
        raise Conflict(
            "Processors may only be changed while the project is in draft",
            code="project_not_editable",
            details={"status": locked["project_status"]},
        )
    if not processor_uuids:
        raise ValidationFailed("A project needs at least one processor", field="processor_uuids")

    ids = []
    for uuid in processor_uuids:
        row = await registry_repo.processor_by_uuid(conn, uuid)
        if not row:
            raise ValidationFailed(f"Processor {uuid} not found", field="processor_uuids")
        ids.append(row["processor_id"])

    await repo.set_processors(conn, project["project_id"], ids, actor_id=actor_id)
    await audit.record(
        conn,
        event=Event.PROJECT_UPDATED,
        entity_type="project",
        entity_id=project["project_id"],
        detail={"processors": processor_uuids},
    )
    return await repo.processors_for(conn, project["project_id"])


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

    # Publication is a side effect of pending_approval -> approved, and it happens
    # in this transaction. A project that moved without its notice publishing
    # would be collecting against text nobody froze - and a notice published
    # before approval would be a promise made on behalf of a decision nobody had
    # taken.
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


async def assign_source(
    conn: Conn,
    *,
    project_uuid: str,
    site_uuid: str,
    source_uuid: str | None,
    actor_id: int,
    role: Role | str,
) -> dict[str, Any]:
    """Attach a data source to one of the project's sites. The routing action.

    This is the DCO Admin's job on a third-party project, and the R&D owner's on
    an in-house one. Both are the same operation because both answer the same
    question - which source stands at this site - and the answer decides who
    picks up the work, because the source carries its own owner.

    Passing `None` detaches. That is a real operation: a site between sources is
    honestly unassigned, and leaving the previous one attached would say
    collection is happening somewhere it is not.

    The owner is not an argument. `trg_site_owner` re-derives
    `project.dco_user_id` from the primary site on commit, so the response reads
    the project back rather than predicting it - the database decides, and this
    reports what it decided.
    """
    project = await repo.require(conn, project_uuid, role=role, user_id=actor_id, write=True)
    site = await repo.site_by_uuid(conn, site_uuid, role=role, user_id=actor_id)
    if not site or site["project_id"] != project["project_id"]:
        raise NotFound("Site")

    source = None
    if source_uuid:
        source = await registry_repo.source_by_uuid(conn, source_uuid)
        if not source:
            raise NotFound("Data source")
        if source["status"] != "active":
            raise ValidationFailed("That data source is not active", field="source_uuid")
        # The source must sit under a processor the DPO has *agreed to* - not
        # merely one somebody put on the list. Otherwise a project approved for
        # collection by one organisation would start collecting through another
        # while the request to add it was still pending, and the notice would
        # name the wrong recipient.
        named = await repo.approved_processor_uuids(conn, project["project_id"])
        if str(source.get("processor_uuid") or "") not in named:
            raise ValidationFailed(
                "That data source belongs to a processor this project has not had approved",
                field="source_uuid",
            )

    before = await repo.project_dco_id(conn, project["project_id"])
    await repo.set_site_source(conn, site["site_id"], source["source_id"] if source else None)
    after = await repo.project_dco_id(conn, project["project_id"])

    await audit.record(
        conn,
        event=Event.SITE_DCO_ASSIGNED,
        entity_type="project_site",
        entity_id=site["site_id"],
        subject_user_id=after,
        detail={
            "project": project_uuid,
            "source": source_uuid,
            "owner_changed": before != after,
        },
    )
    return {
        "project_uuid": project_uuid,
        "site_uuid": site_uuid,
        "source_uuid": source_uuid,
        "owner_changed": before != after,
    }


async def assign_site_owner(
    conn: Conn,
    *,
    project_uuid: str,
    site_uuid: str,
    owner_user_uuid: str | None,
    actor_id: int,
    role: Role | str,
) -> dict[str, Any]:
    """Name who runs one site, overriding the owner its data source implies.

    Attaching the source picks the owner automatically, and that is right almost
    every time. This is for when it is not: cover, a handover, a partner who
    insists on a named contact. It is an exception to the derivation and is
    recorded as one - who made it and when - rather than replacing it.

    **It does not move the source.** Reassigning the rig would hand every other
    project collecting from it to the new person too, as a side effect of a
    decision about this one, and the person making that decision can see only
    the project in front of them. The source keeps its owner; this site does
    not follow it.

    Several sites on one project can each name a different person. The project
    itself still belongs to its *primary* site's owner - that is what decides
    whose list it appears in for writing - while everybody holding any of its
    sites can read it.
    """
    project = await repo.require(conn, project_uuid, role=role, user_id=actor_id, write=True)
    site = await repo.site_by_uuid(conn, site_uuid, role=role, user_id=actor_id)
    if not site or site["project_id"] != project["project_id"]:
        raise NotFound("Site")

    owner_id = None
    if owner_user_uuid is not None:
        # An override answers "who runs this instead of the source's owner", so
        # there has to be a source for it to be instead *of*. Without one there
        # is nothing being overridden and the right operation is to attach a
        # source, which picks an owner on its own.
        if not site.get("source_id"):
            raise ValidationFailed(
                "Attach a data source to this site first - naming somebody is an "
                "exception to the owner the source implies, and there is no source yet",
                field="owner_user_uuid",
            )

        owner = await user_repo.by_uuid(conn, owner_user_uuid)
        if not owner:
            raise NotFound("User")
        if owner["status"] != "active":
            raise ValidationFailed("That account is not active", field="owner_user_uuid")

        # The same rule the source itself is held to: in-house collection is an
        # RCO's, a third party's is a DCO's. Applied here as well because this
        # path decides accountability too, and a rule enforced in one of two
        # places is a rule with a way round it.
        wanted = Role.RCO if site.get("is_in_house") else Role.DCO
        if owner["role"] != wanted.value:
            raise ValidationFailed(
                (
                    "Collection at this site is in-house, so an R&D Collection Owner "
                    "is accountable for it"
                    if site.get("is_in_house")
                    else "Collection at this site is by a third party, so a Data "
                    "Collection Owner is accountable for it"
                ),
                field="owner_user_uuid",
            )
        owner_id = owner["id"]

    before = await repo.project_dco_id(conn, project["project_id"])
    await repo.set_site_owner_override(conn, site["site_id"], owner_id, actor_id=actor_id)
    after = await repo.project_dco_id(conn, project["project_id"])

    await audit.record(
        conn,
        event=Event.SITE_DCO_ASSIGNED,
        entity_type="project_site",
        entity_id=site["site_id"],
        subject_user_id=owner_id,
        detail={
            "project": project_uuid,
            "site_label": site["site_label"],
            "owner": owner_user_uuid,
            "override_cleared": owner_user_uuid is None,
            "project_owner_changed": before != after,
        },
    )
    return {
        "project_uuid": project_uuid,
        "site_uuid": site_uuid,
        "owner_user_uuid": owner_user_uuid,
        "project_moved": before != after,
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

    # Draft is where an approval is attached now: submitting for review requires
    # one, so it has to be possible to add it before submitting. Still allowed
    # while pending, because a DPO asking for a second sign-off should not need
    # the project sent back to draft first.
    if project["project_status"] not in (
        ProjectStatus.IN_DRAFT.value,
        ProjectStatus.PENDING_APPROVAL.value,
    ):
        raise Conflict(
            "Approvals may only be added before the project is approved",
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
    source_uuid: str,
    location: str | None = None,
) -> dict[str, Any]:
    """Register where collection will happen: one data source, deployed here.

    A site is not a thing with a name of its own - it is a source standing
    somewhere. So the source is the only thing asked for, and everything else
    follows from it: the processor (a source belongs to one), the label (the
    source's name), and who is accountable (the source carries its owner).
    Asking for those separately invited them to disagree, and a site whose label
    said one thing while its source said another had two answers to one
    question.

    `trg_site_owner` hands the project to that owner on commit where this is its
    first owned site - which is how a project reaches a DCO without anybody
    nominating one on the project itself.

    Adding a site is a **material change**: it adds a recipient to the notice,
    so it requires a new notice version. The service flags it; the DPO decides.
    What it must not do is quietly change who the data goes to while the
    published notice still names the old list.
    """
    from cmp.db.repositories import registry as registry_repo

    project = await repo.require(conn, project_uuid, role=role, user_id=actor_id, write=True)

    source = await registry_repo.source_by_uuid(conn, source_uuid)
    if not source:
        raise NotFound("Data source")
    if source["status"] != "active":
        raise ValidationFailed("That data source is not active", field="source_uuid")

    # Under one of this project's own processors, or the project would be
    # collecting through an organisation the DPO never reviewed.
    named = await repo.approved_processor_uuids(conn, project["project_id"])
    if str(source.get("processor_uuid") or "") not in named:
        raise ValidationFailed(
            "That data source belongs to a processor this project has not had approved",
            field="source_uuid",
        )

    # One deployment per source per project. A second site for the same rig is
    # not a second place - it is the same place entered twice, and it would give
    # the notice's recipient list a duplicate.
    # Unfiltered on purpose: a site the caller cannot see is still a site, and
    # a duplicate check that skipped it would let the same rig be deployed twice
    # and put a duplicate in the notice's recipient list.
    for existing in await repo.list_sites(conn, project["project_id"]):
        if existing.get("source_uuid") and str(existing["source_uuid"]) == str(source_uuid):
            raise Conflict(
                f"{source['name']} is already a collection site on this project",
                code="site_exists",
            )

    site = await repo.add_site(
        conn,
        project_id=project["project_id"],
        # The source's name, because that is what this site is. Stored rather
        # than resolved on read: it is copied into `recipients_text` when the
        # notice publishes, and that copy has to be what the data principal was
        # actually shown even if the registry is renamed afterwards.
        site_label=source["name"],
        location=location,
        processor_id=source.get("processor_id"),
        source_id=source["source_id"],
    )

    facts = await repo.facts(conn, project["project_id"])
    material = bool(facts.get("notice_published"))

    await audit.record(
        conn,
        event=Event.SITE_CREATED,
        entity_type="project_site",
        entity_id=site["site_id"],
        detail={
            "project": project_uuid,
            "site_label": source["name"],
            "source": source_uuid,
            "material_change": material,
        },
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
