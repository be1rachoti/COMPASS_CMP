/**
 * The dashboard payload.
 *
 * One endpoint, role-aware: the response differs by role but the call does not,
 * so the console has one loading path rather than five.
 */

import { apiGet } from "@/lib/api";
import type { DashboardData } from "@/types";

export function getDashboard(): Promise<DashboardData> {
  return apiGet<DashboardData>("/dashboard");
}
