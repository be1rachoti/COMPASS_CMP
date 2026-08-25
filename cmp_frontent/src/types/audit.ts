/**
 * The audit trail.
 *
 * The `entity_*` fields are resolved server-side at read time. The trail stores
 * `notice#42` because a surrogate key is the only reference guaranteed to stay
 * valid — codes get reused, projects get renamed — and these four turn it into
 * something a person can read and click. All null once the row it describes has
 * been deleted; the trail outlives what it records.
 */

import type { Role } from "@/types/enums";
import type { Timestamp, Uuid } from "@/types/primitives";

export interface AuditEntry {
  log_uuid: Uuid;
  event_type: string;
  /** The table name, exactly. */
  entity_type: string;
  entity_id: number;
  occurred_at: Timestamp;
  detail: Record<string, unknown> | null;
  actor_uuid: Uuid | null;
  actor_name: string | null;
  actor_role: Role | null;
  subject_uuid: Uuid | null;
  subject_name: string | null;

  /* The trail stores `notice#42` because that reference never goes stale. The
   * server resolves it at read time into something a person can read and click.
   * All four are null once the row it describes has been deleted — the trail
   * outlives what it records, which is the whole point of it. */
  entity_uuid: Uuid | null;
  entity_label: string | null;
  /** "Notice", "Consent record", "Project" — what kind of thing this is. */
  entity_noun: string | null;
  /** In-app path, or null where the product has no page for that thing. */
  entity_href: string | null;
}

export interface AuditVerification {
  intact: boolean;
  rows_checked: number;
  last_log_id: number | null;
  first_break: { log_id: number; occurred_at: Timestamp; reason: string } | null;
  message: string;
}
