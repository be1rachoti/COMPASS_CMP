/**
 * The data principal's own view of their consents.
 */
"use client";

import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api";
import type { ApiError } from "@/lib/errors";
import { keys } from "@/lib/query";
import type { MyConsent, PurposeGrant, Uuid } from "@/types";

export function useMyConsents() {
  return useQuery<MyConsent[], ApiError>({
    queryKey: keys.me.consents,
    queryFn: () => apiGet<MyConsent[]>("/me/consents"),
  });
}

export function useMyConsentGrants(uuid: Uuid | undefined) {
  return useQuery<PurposeGrant[], ApiError>({
    queryKey: keys.me.consentGrants(uuid ?? ""),
    queryFn: () => apiGet<PurposeGrant[]>(`/me/consents/${uuid}/grants`),
    enabled: Boolean(uuid),
  });
}

export function useMyConsentHistory(uuid: Uuid | undefined) {
  return useQuery({
    queryKey: keys.me.consentHistory(uuid ?? ""),
    queryFn: () => apiGet(`/me/consents/${uuid}/history`),
    enabled: Boolean(uuid),
  });
}

/** The exact text she was shown, matched on the hash copied at capture. */
export function useMyConsentNotice(uuid: Uuid | undefined) {
  return useQuery({
    queryKey: keys.me.consentNotice(uuid ?? ""),
    queryFn: () => apiGet(`/me/consents/${uuid}/notice`),
    enabled: Boolean(uuid),
  });
}

export function useMyDisclosures() {
  return useQuery({
    queryKey: keys.me.disclosures,
    queryFn: () => apiGet("/me/disclosures"),
  });
}
