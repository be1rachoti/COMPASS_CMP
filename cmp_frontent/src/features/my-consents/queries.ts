/**
 * The data principal's own view of their consents.
 */
"use client";

import { useQuery } from "@tanstack/react-query";

import {
  getMyConsentNotice,
  listMyConsentGrants,
  listMyConsentHistory,
  listMyConsentTrail,
  listMyConsents,
  listMyDisclosures,
} from "@/features/my-consents/api";
import type { ApiError } from "@/lib/errors";
import { keys } from "@/lib/query";
import type {
  AuditEntry,
  MyConsent,
  PurposeGrant,
  Uuid,
} from "@/types";

export function useMyConsents() {
  return useQuery<MyConsent[], ApiError>({
    queryKey: keys.me.consents,
    queryFn: () => listMyConsents(),
  });
}

export function useMyConsentGrants(uuid: Uuid | undefined) {
  return useQuery<PurposeGrant[], ApiError>({
    queryKey: keys.me.consentGrants(uuid ?? ""),
    queryFn: () => listMyConsentGrants(uuid!),
    enabled: Boolean(uuid),
  });
}

export function useMyConsentHistory(uuid: Uuid | undefined) {
  return useQuery({
    queryKey: keys.me.consentHistory(uuid ?? ""),
    queryFn: () => listMyConsentHistory(uuid!),
    enabled: Boolean(uuid),
  });
}

/** The exact text she was shown, matched on the hash copied at capture. */
export function useMyConsentNotice(uuid: Uuid | undefined) {
  return useQuery({
    queryKey: keys.me.consentNotice(uuid ?? ""),
    queryFn: () => getMyConsentNotice(uuid!),
    enabled: Boolean(uuid),
  });
}

export function useMyDisclosures() {
  return useQuery({
    queryKey: keys.me.disclosures,
    queryFn: () => listMyDisclosures(),
  });
}

export function useMyConsentTrail(uuid: Uuid | undefined) {
  return useQuery<AuditEntry[], ApiError>({
    queryKey: keys.me.consentTrail(uuid ?? ""),
    queryFn: () => listMyConsentTrail(uuid!),
    enabled: Boolean(uuid),
  });
}
