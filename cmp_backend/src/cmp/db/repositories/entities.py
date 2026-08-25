"""Resolving `(entity_type, entity_id)` into something a person can read.

The audit trail records what was touched as a table name and a surrogate key,
because that is the only reference guaranteed to stay valid: a notice code can be
reused, a project renamed, a user deleted from a directory. `notice#42` is
precise and permanent, and completely useless to the person reading the screen.

This module is the bridge. It takes the pairs a page of audit rows contains and
returns, for each, a label, the public uuid, and where in the product it lives -
so "Notice published" becomes "NTC-GAIT-2026 v1" with a link to the notice, and
the DPO can see *what* was published without running a query by hand.

Two rules hold throughout:

* **One query per entity type, never one per row.** A page of 25 rows touching
  four tables costs four queries, not twenty-five.
* **A row that no longer exists resolves to nothing, not to an error.** The audit
  trail outlives what it describes; a deleted source must not make the whole page
  fail to load.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from cmp.db.sql import Conn, fetch_all


@dataclass(frozen=True)
class _Spec:
    """How to turn one table's ids into labels.

    `sql` must select `id`, `uuid` and `label`. `href` is a template over `uuid`,
    or None where the product has no page for that thing - a link to nowhere is
    worse than no link.
    """

    sql: str
    href: str | None = None
    #: Shown next to the label so "Priya Menon" reads as an account rather than a
    #: data subject, and a consent record reads as a consent record.
    noun: str = ""


_SPECS: dict[str, _Spec] = {
    "project": _Spec(
        sql="""SELECT project_id AS id, project_uuid::text AS uuid,
                      project_name AS label
               FROM project WHERE project_id = ANY(%s)""",
        href="/projects/{uuid}",
        noun="Project",
    ),
    "notice": _Spec(
        sql="""SELECT n.notice_id AS id, n.notice_uuid::text AS uuid,
                      n.notice_code || ' v' || n.version || ' — ' || p.project_name AS label
               FROM notice n JOIN project p ON p.project_id = n.project_id
               WHERE n.notice_id = ANY(%s)""",
        href="/notices/{uuid}",
        noun="Notice",
    ),
    "notice_language": _Spec(
        # The language rendition has no page of its own; it lives on the notice,
        # so that is where the link points.
        sql="""SELECT nl.notice_language_id AS id, n.notice_uuid::text AS uuid,
                      n.notice_code || ' v' || n.version
                        || ' (' || nl.language_code || ')' AS label
               FROM notice_language nl JOIN notice n ON n.notice_id = nl.notice_id
               WHERE nl.notice_language_id = ANY(%s)""",
        href="/notices/{uuid}",
        noun="Notice rendition",
    ),
    "notice_purpose": _Spec(
        sql="""SELECT np.notice_purpose_id AS id, n.notice_uuid::text AS uuid,
                      pu.name || ' on ' || n.notice_code || ' v' || n.version AS label
               FROM notice_purpose np
               JOIN notice n  ON n.notice_id = np.notice_id
               JOIN purpose pu ON pu.purpose_id = np.purpose_id
               WHERE np.notice_purpose_id = ANY(%s)""",
        href="/notices/{uuid}",
        noun="Purpose on notice",
    ),
    "purpose": _Spec(
        sql="""SELECT purpose_id AS id, purpose_uuid::text AS uuid,
                      name || ' (' || purpose_code || ')' AS label
               FROM purpose WHERE purpose_id = ANY(%s)""",
        href="/purposes/{uuid}",
        noun="Purpose",
    ),
    "processor": _Spec(
        sql="""SELECT processor_id AS id, processor_uuid::text AS uuid,
                      legal_name AS label
               FROM processor WHERE processor_id = ANY(%s)""",
        href="/processors",
        noun="Processor",
    ),
    "data_source": _Spec(
        sql="""SELECT source_id AS id, source_uuid::text AS uuid,
                      name || ' (' || source_code || ')' AS label
               FROM data_source WHERE source_id = ANY(%s)""",
        href="/sources",
        noun="Data source",
    ),
    "project_site": _Spec(
        sql="""SELECT s.site_id AS id, s.site_uuid::text AS uuid,
                      s.site_label || ' — ' || p.project_name AS label
               FROM project_site s JOIN project p ON p.project_id = s.project_id
               WHERE s.site_id = ANY(%s)""",
        href="/sites",
        noun="Collection site",
    ),
    "project_approval": _Spec(
        sql="""SELECT a.approval_id AS id, a.approval_uuid::text AS uuid,
                      a.approval_type::text || ' ' || a.reference_no
                        || ' — ' || p.project_name AS label
               FROM project_approval a JOIN project p ON p.project_id = a.project_id
               WHERE a.approval_id = ANY(%s)""",
        href="/approvals",
        noun="Approval",
    ),
    "consent_link": _Spec(
        sql="""SELECT cl.link_id AS id, cl.link_uuid::text AS uuid,
                      s.site_label || ' — ' || p.project_name AS label
               FROM consent_link cl
               JOIN project_site s ON s.site_id = cl.site_id
               JOIN notice n       ON n.notice_id = cl.notice_id
               JOIN project p      ON p.project_id = n.project_id
               WHERE cl.link_id = ANY(%s)""",
        href="/links",
        noun="Consent link",
    ),
    "consent_artefact": _Spec(
        sql="""SELECT ca.consent_id AS id, ca.consent_uuid::text AS uuid,
                      u.full_name || ' — ' || p.project_name AS label
               FROM consent_artefact ca
               JOIN auth_user u ON u.id = ca.auth_user_id
               JOIN notice n    ON n.notice_id = ca.notice_id
               JOIN project p   ON p.project_id = n.project_id
               WHERE ca.consent_id = ANY(%s)""",
        href="/consents/{uuid}",
        noun="Consent record",
    ),
    "import_batch": _Spec(
        sql="""SELECT batch_id AS id, batch_uuid::text AS uuid, file_name AS label
               FROM import_batch WHERE batch_id = ANY(%s)""",
        href="/imports/{uuid}",
        noun="Import batch",
    ),
    "collection": _Spec(
        sql="""SELECT collection_id AS id, collection_uuid::text AS uuid,
                      source_collection_ref AS label
               FROM collection WHERE collection_id = ANY(%s)""",
        href="/collections/{uuid}",
        noun="Collection",
    ),
    "export_log": _Spec(
        sql="""SELECT e.export_id AS id, e.export_uuid::text AS uuid,
                      e.export_type::text || ' — ' || p.project_name AS label
               FROM export_log e JOIN project p ON p.project_id = e.project_id
               WHERE e.export_id = ANY(%s)""",
        href="/exports",
        noun="Export",
    ),
    "auth_user": _Spec(
        sql="""SELECT id, uuid::text AS uuid, full_name AS label
               FROM auth_user WHERE id = ANY(%s)""",
        href="/users",
        noun="Account",
    ),
    "person_type_history": _Spec(
        sql="""SELECT h.history_id AS id, u.uuid::text AS uuid,
                      u.full_name || ': ' || coalesce(h.from_type::text, 'none')
                        || ' → ' || h.to_type::text AS label
               FROM person_type_history h JOIN auth_user u ON u.id = h.auth_user_id
               WHERE h.history_id = ANY(%s)""",
        href="/users",
        noun="Person type change",
    ),
}


async def resolve(conn: Conn, refs: list[tuple[str, int]]) -> dict[tuple[str, int], dict[str, Any]]:
    """Label a batch of `(entity_type, entity_id)` pairs.

    Unknown entity types and rows that no longer exist are simply absent from the
    result; the caller renders the raw `type#id` for those, which is still true.
    """
    by_type: dict[str, set[int]] = {}
    for entity_type, entity_id in refs:
        if entity_type in _SPECS and entity_id:
            by_type.setdefault(entity_type, set()).add(entity_id)

    resolved: dict[tuple[str, int], dict[str, Any]] = {}
    for entity_type, ids in by_type.items():
        spec = _SPECS[entity_type]
        rows = await fetch_all(conn, spec.sql, (list(ids),))
        for row in rows:
            uuid = row["uuid"]
            resolved[(entity_type, int(row["id"]))] = {
                "entity_uuid": uuid,
                "entity_label": row["label"],
                "entity_noun": spec.noun,
                "entity_href": spec.href.format(uuid=uuid) if spec.href else None,
            }
    return resolved


async def attach(conn: Conn, rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Enrich audit rows in place with their resolved entity, and return them."""
    refs = [(str(r.get("entity_type") or ""), int(r.get("entity_id") or 0)) for r in rows]
    resolved = await resolve(conn, refs)
    for row, ref in zip(rows, refs, strict=True):
        row.update(
            resolved.get(
                ref,
                {
                    "entity_uuid": None,
                    "entity_label": None,
                    "entity_noun": "",
                    "entity_href": None,
                },
            )
        )
    return rows
