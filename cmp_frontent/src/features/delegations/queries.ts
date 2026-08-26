/**
 * Reading cover arrangements.
 */
"use client";

import { useQuery } from "@tanstack/react-query";

import {
  listAllDelegations,
  listHeldDelegations,
  listMyDelegations,
} from "@/features/delegations/api";
import type { ApiError } from "@/lib/errors";
import { keys } from "@/lib/query";
import type { Delegation } from "@/types";

export function useMyDelegations() {
  return useQuery<Delegation[], ApiError>({
    queryKey: keys.delegations.mine,
    queryFn: listMyDelegations,
  });
}

export function useHeldDelegations() {
  return useQuery<Delegation[], ApiError>({
    queryKey: keys.delegations.held,
    queryFn: listHeldDelegations,
  });
}

/** DPO and administrator only. Gated by the caller so the hook stays honest
 *  about being a fetch rather than a permission check. */
export function useAllDelegations(enabled = true) {
  return useQuery<Delegation[], ApiError>({
    queryKey: keys.delegations.all,
    queryFn: listAllDelegations,
    enabled,
  });
}
