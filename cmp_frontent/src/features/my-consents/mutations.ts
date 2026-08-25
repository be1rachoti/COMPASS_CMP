/**
 * my-consents mutations.
 */
"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";

import { withdrawConsent, type WithdrawInput } from "@/features/my-consents/api";
import type { ApiError } from "@/lib/errors";
import type { Uuid, WithdrawalResult } from "@/types";

export function useWithdraw(consentUuid: Uuid) {
  const qc = useQueryClient();
  return useMutation<WithdrawalResult, ApiError, { purposes?: Uuid[]; all?: boolean }>({
    mutationFn: (body: WithdrawInput) => withdrawConsent(consentUuid, body),
    onSuccess: () => {
      // Withdrawal creates a *new* artefact that supersedes this one, so the
      // whole /me tree is stale, not just this record.
      void qc.invalidateQueries({ queryKey: ["me"] });
    },
  });
}
