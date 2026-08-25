/**
 * The dashboard payload. One endpoint, role-aware — the response shape differs
 * by role but the call does not, so the console has one loading path.
 */

import type { Role } from "@/types/enums";

export interface DashboardData {
  role: Role;
  counts: Record<string, number>;
  queues: Array<{ name: string; items: Array<Record<string, unknown>> }>;
  recent: Array<Record<string, unknown>>;
}
