/**
 * Reading and verifying the audit trail.
 */
"use client";

import { useQuery } from "@tanstack/react-query";

import { listAudit, verifyAuditChain } from "@/features/audit/api";
import type { ApiError } from "@/lib/errors";
import { keys } from "@/lib/query";
import type { AuditEntry, AuditVerification, Page } from "@/types";

export function useAudit(filters: Record<string, unknown> = {}) {
  return useQuery<Page<AuditEntry>, ApiError>({
    queryKey: keys.audit.list(filters),
    queryFn: () => listAudit(filters),
  });
}

export function useAuditVerify(enabled = false) {
  return useQuery<AuditVerification, ApiError>({
    queryKey: keys.audit.verify,
    queryFn: () => verifyAuditChain(),
    // Walking the whole chain is not free. Run it on request, not on page load.
    enabled,
    staleTime: 0,
    gcTime: 0,
  });
}
