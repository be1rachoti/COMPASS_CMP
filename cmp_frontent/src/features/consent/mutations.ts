/**
 * Revoking links. Consent itself is only ever written by the data principal.
 */
"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiPost } from "@/lib/api";
import type { ApiError } from "@/lib/errors";
import type { Uuid } from "@/types";

export function useRevokeLink() {
  const qc = useQueryClient();
  return useMutation<{ ok: boolean; message?: string }, ApiError, Uuid>({
    mutationFn: (uuid) => apiPost(`/links/${uuid}/revoke`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["all", "links"] });
      void qc.invalidateQueries({ queryKey: ["project"] });
    },
  });
}
