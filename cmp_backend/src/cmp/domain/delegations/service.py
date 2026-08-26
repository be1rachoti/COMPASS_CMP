"""Granting and revoking cover.

Three rules, and each one exists because its absence would be exploitable or
confusing rather than merely untidy.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from cmp.core.errors import Conflict, Forbidden, NotFound, ValidationFailed
from cmp.core.permissions import Role
from cmp.db.repositories import delegations as repo
from cmp.db.repositories import users as user_repo
from cmp.db.sql import Conn
from cmp.domain.audit import service as audit
from cmp.domain.audit.service import Event

#: Roles for which cover is a meaningful arrangement.
#:
#: An R&D User's scope is `own` — the projects they created — and nobody can
#: cover that: the rows are defined by authorship, and a delegate acting on them
#: would be acting on somebody else's submission. A data subject's rows are
#: their own person. Neither is a gap; both are the scope working as intended.
DELEGABLE = frozenset({Role.DPO, Role.DCO})


async def grant(
    conn: Conn,
    *,
    delegator_uuid: str,
    delegate_uuid: str,
    reason: str | None,
    starts_at: datetime | None,
    ends_at: datetime | None,
    actor_id: int,
    actor_role: Role | str,
) -> dict[str, Any]:
    """Arrange for one person to cover another.

    **Same role only.** A DCO may be covered by a DCO. Allowing it across roles
    would make this an escalation path: a DCO delegated to by a DPO would read
    every project in the organisation, through a feature named after helping out
    while somebody is on leave.

    **You arrange your own cover, or an administrator does.** A third party
    granting themselves somebody else's access is the whole attack; requiring
    the delegator to be the actor removes it. An administrator is excepted
    because the realistic case is somebody already unreachable — that is what
    the cover is *for* — and the audit trail records who arranged it.

    **A DPO delegation grants no extra rows, and says so.** A DPO already reads
    everything, so there is nothing to extend. The record is still worth having:
    it answers "who was covering the privacy function that week". Returning
    `grants_access: false` is how the API avoids implying an effect it does not
    have.
    """
    delegator = await user_repo.by_uuid(conn, delegator_uuid)
    if not delegator:
        raise NotFound("User")
    delegate = await user_repo.by_uuid(conn, delegate_uuid)
    if not delegate:
        raise NotFound("User")

    if delegator["id"] == delegate["id"]:
        raise ValidationFailed("Nobody can cover for themselves", field="delegate_user_uuid")

    if actor_role != Role.ADMIN and delegator["id"] != actor_id:
        raise Forbidden("You can only arrange cover for your own work")

    if delegator["role"] != delegate["role"]:
        raise ValidationFailed(
            "Cover has to be arranged with somebody in the same role. "
            f"{delegator['full_name']} is a {delegator['role']}; "
            f"{delegate['full_name']} is a {delegate['role']}.",
            field="delegate_user_uuid",
        )

    if Role(delegator["role"]) not in DELEGABLE:
        raise ValidationFailed(
            f"Cover is not something a {delegator['role']} can arrange. It applies to "
            "roles whose access is defined by assignment, not by authorship.",
            field="delegator_user_uuid",
        )

    if delegate["status"] != "active":
        raise ValidationFailed("That account is not active", field="delegate_user_uuid")

    if ends_at is not None and ends_at <= (starts_at or datetime.now(UTC)):
        raise ValidationFailed("Cover has to end after it starts", field="ends_at")

    existing = await repo.live_between(
        conn, delegator_user_id=delegator["id"], delegate_user_id=delegate["id"]
    )
    if existing:
        raise Conflict(
            f"{delegate['full_name']} is already covering for {delegator['full_name']}. "
            "Revoke that arrangement first if the dates need to change."
        )

    row = await repo.create(
        conn,
        delegator_user_id=delegator["id"],
        delegate_user_id=delegate["id"],
        reason=reason,
        starts_at=starts_at,
        ends_at=ends_at,
        created_by=actor_id,
    )

    await audit.record(
        conn,
        event=Event.DELEGATION_GRANTED,
        entity_type="delegation",
        entity_id=row["delegation_id"],
        subject_user_id=delegate["id"],
        detail={
            "delegator": delegator_uuid,
            "delegate": delegate_uuid,
            "role": delegator["role"],
            "ends_at": ends_at.isoformat() if ends_at else None,
            "reason": reason,
        },
    )

    grants_access = Role(delegator["role"]) is not Role.DPO
    return {
        "delegation_uuid": row["delegation_uuid"],
        "grants_access": grants_access,
        "message": (
            f"{delegate['full_name']} is now covering for {delegator['full_name']}."
            if grants_access
            else (
                f"Recorded: {delegate['full_name']} is covering for "
                f"{delegator['full_name']}. A DPO already reads every record, so this "
                "grants no additional access — it is the record of who was covering."
            )
        ),
    }


async def revoke(
    conn: Conn, *, delegation_uuid: str, actor_id: int, actor_role: Role | str
) -> dict[str, Any]:
    """End cover now.

    Either party may end it, and so may an administrator. The delegator because
    it is their work; the delegate because being handed access one does not want
    is a real situation and refusing it should not need a ticket.
    """
    row = await repo.by_uuid(conn, delegation_uuid)
    if not row:
        raise NotFound("Delegation")

    permitted = {row["delegator_user_id"], row["delegate_user_id"]}
    if actor_role != Role.ADMIN and actor_id not in permitted:
        raise Forbidden("Only the people named on this arrangement can end it")

    if row["revoked_at"] is not None:
        # Not an error: the desired state is the actual state. Saying so is more
        # useful than a 409 about a state the caller wanted anyway.
        return {"ok": True, "message": "That arrangement had already ended."}

    await repo.revoke(conn, row["delegation_id"], revoked_by=actor_id)
    await audit.record(
        conn,
        event=Event.DELEGATION_REVOKED,
        entity_type="delegation",
        entity_id=row["delegation_id"],
        subject_user_id=row["delegate_user_id"],
        detail={"delegator": str(row["delegator_uuid"]), "delegate": str(row["delegate_uuid"])},
    )
    return {
        "ok": True,
        "message": f"{row['delegate_name']} is no longer covering for {row['delegator_name']}.",
    }
