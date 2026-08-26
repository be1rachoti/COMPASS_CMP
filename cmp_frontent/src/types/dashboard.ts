/**
 * The dashboard payload. One endpoint, role-aware — the response shape differs
 * by role but the call does not, so the console has one loading path.
 */

import type { AuditEntry } from "@/types/audit";
import type { Role } from "@/types/enums";

export interface DashboardData {
  role: Role;
  counts: Record<string, number>;
  queues: Array<{ name: string; items: Array<Record<string, unknown>> }>;
  /**
   * Recent activity, as audit entries — for every role.
   *
   * It was `Record<string, unknown>[]` because each role's endpoint returned a
   * different shape: project rows for an R&D User, exports for a DCO, a partial
   * audit projection for a DPO. The panel then guessed at a label from whichever
   * columns happened to be present, and could say that something changed without
   * saying what or who.
   *
   * Now one shape, so one renderer, and the dashboard panel cannot disagree with
   * the audit trail it is drawn from.
   */
  recent: AuditEntry[];
}
