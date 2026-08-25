/**
 * The notification feed.
 *
 * Derived from the audit trail rather than kept in a second table that could
 * disagree with it — which is why the response is typed as audit entries and
 * the same detail renderer serves both surfaces.
 */

import { apiGet } from "@/lib/api";
import type { AuditEntry } from "@/types";

export function listNotifications(limit = 50): Promise<{ items: AuditEntry[]; total: number }> {
  return apiGet<{ items: AuditEntry[]; total: number }>(`/notifications?limit=${limit}`);
}
