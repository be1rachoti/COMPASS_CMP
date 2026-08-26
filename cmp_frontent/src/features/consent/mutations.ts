/**
 * Revoking links.
 *
 * Consent itself is only ever written by the data principal, through the public
 * flow. There is no staff-facing "grant consent" here and there should never
 * be: a consent recorded by somebody other than the person it belongs to is not
 * consent, and s.6(1) requires the act to be theirs.
 */
"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";

import { remintLink, revokeLink, type RemintedLink } from "@/features/consent/api";
import { keys, prefixes, type Result } from "@/lib/query";
import type { Uuid } from "@/types";

export function useRevokeLink(): Result<{ ok: boolean; message?: string }, Uuid> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: revokeLink,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.consent.allLinks() });
      // The link belongs to a site, which belongs to a project, and neither is
      // known here. Invalidate the prefix rather than guess wrong.
      void qc.invalidateQueries({ queryKey: prefixes.anyProject });
    },
  });
}

/**
 * Replace a link with a fresh one.
 *
 * Invalidates the same keys as a revoke, because that is half of what it did.
 * The caller keeps the returned token — it is not in the cache and cannot be
 * refetched.
 */
export function useRemintLink(): Result<RemintedLink, Uuid> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: remintLink,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.consent.allLinks() });
      void qc.invalidateQueries({ queryKey: prefixes.anyProject });
    },
  });
}
