/**
 * The signed-in user editing their own profile.
 */
"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Result } from "@/lib/query";
import { apiPatch, apiPost } from "@/lib/api";
import { keys } from "@/lib/query";
import type { Acknowledged } from "@/types";

export function useUpdateMe(): Result<unknown, { full_name?: string; mobile?: string }> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body) => apiPatch("/me", body),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.auth.me }),
  });
}

export function useSetPersonType(): Result<
  Acknowledged,
  { person_type: string; reason?: string }
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body) => apiPost<Acknowledged>("/me/person-type", body),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.auth.me }),
  });
}
