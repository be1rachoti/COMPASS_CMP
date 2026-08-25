/**
 * The audit trail.
 *
 * Read-only by construction: the table is append-only, enforced by a trigger,
 * and there is no endpoint that would edit or remove a row. The only write-ish
 * operation is the verification below, which reads the chain and reports on it.
 */

import { apiGet, queryString } from "@/lib/api";
import type { AuditEntry, AuditVerification, Page } from "@/types";

export function listAudit(filters: Record<string, unknown> = {}): Promise<Page<AuditEntry>> {
  return apiGet<Page<AuditEntry>>(`/audit${queryString(filters)}`);
}

/**
 * Recompute the SHA-256 hash chain and report the first break, if any.
 *
 * Expensive — it walks the table — which is why the hook that calls it is
 * disabled until somebody explicitly asks.
 */
export function verifyAuditChain(): Promise<AuditVerification> {
  return apiGet<AuditVerification>("/audit/verify");
}
