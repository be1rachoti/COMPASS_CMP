/**
 * Arranging and ending cover.
 *
 * Both invalidate every delegation list *and* the project prefix: cover changes
 * which projects the delegate can reach, so a stale project list would show
 * them a world they no longer have — or hide one they just gained.
 */
"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";

import {
  grantDelegation,
  revokeDelegation,
  type DelegationInput,
} from "@/features/delegations/api";
import { keys, prefixes, type Result } from "@/lib/query";
import type { Acknowledged, DelegationGranted, Uuid } from "@/types";

function useInvalidateDelegations() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: keys.delegations.mine });
    void qc.invalidateQueries({ queryKey: keys.delegations.held });
    void qc.invalidateQueries({ queryKey: keys.delegations.all });
    void qc.invalidateQueries({ queryKey: prefixes.anyProject });
    void qc.invalidateQueries({ queryKey: keys.project.list() });
  };
}

export function useGrantDelegation(): Result<DelegationGranted, DelegationInput> {
  const invalidate = useInvalidateDelegations();
  return useMutation({ mutationFn: grantDelegation, onSuccess: invalidate });
}

export function useRevokeDelegation(): Result<Acknowledged, Uuid> {
  const invalidate = useInvalidateDelegations();
  return useMutation({ mutationFn: revokeDelegation, onSuccess: invalidate });
}
