/**
 * Reading consent links, artefacts and grants.
 *
 * Each hook names a cache key and says when the request may run. The requests
 * are in `api.ts`.
 */
"use client";

import { useQuery } from "@tanstack/react-query";

import {
  getConsent,
  getConsentSummary,
  getLinkStats,
  listConsentAssets,
  listConsentGrants,
  listConsents,
  listLinks,
  listProjectConsents,
  listProjectLinks,
} from "@/features/consent/api";
import type { ApiError } from "@/lib/errors";
import { keys, type ListFilters } from "@/lib/query";
import type {
  ConsentArtefact,
  ConsentAsset,
  ConsentLink,
  ConsentListRow,
  ConsentRow,
  LinkListRow,
  LinkStats,
  Page,
  PurposeGrant,
  Uuid,
} from "@/types";

export function useConsents(projectUuid: Uuid | undefined, filters: Record<string, unknown> = {}) {
  return useQuery<Page<ConsentRow>, ApiError>({
    queryKey: keys.consent.list(projectUuid ?? "", filters),
    queryFn: () => listProjectConsents(projectUuid!, filters),
    enabled: Boolean(projectUuid),
  });
}

export function useConsentSummary(projectUuid: Uuid | undefined) {
  return useQuery<Record<string, number>, ApiError>({
    queryKey: keys.consent.summary(projectUuid ?? ""),
    queryFn: () => getConsentSummary(projectUuid!),
    enabled: Boolean(projectUuid),
  });
}

export function useAllConsents(filters: ListFilters = {}) {
  return useQuery<Page<ConsentListRow>, ApiError>({
    queryKey: keys.consent.all(filters),
    queryFn: () => listConsents(filters),
  });
}

export function useConsent(uuid: Uuid | undefined) {
  return useQuery<ConsentArtefact, ApiError>({
    queryKey: keys.consent.detail(uuid ?? ""),
    queryFn: () => getConsent(uuid!),
    enabled: Boolean(uuid),
  });
}

export function useConsentGrants(uuid: Uuid | undefined) {
  return useQuery<PurposeGrant[], ApiError>({
    queryKey: keys.consent.grants(uuid ?? ""),
    queryFn: () => listConsentGrants(uuid!),
    enabled: Boolean(uuid),
  });
}

export function useConsentAssets(uuid: Uuid | undefined) {
  return useQuery<ConsentAsset[], ApiError>({
    queryKey: keys.consent.assets(uuid ?? ""),
    queryFn: () => listConsentAssets(uuid!),
    enabled: Boolean(uuid),
    // A 403 here is a scope answer, not a transient failure. Retrying it just
    // writes more access-denial rows into the audit trail.
    retry: false,
  });
}

export function useLinks(projectUuid: Uuid | undefined) {
  return useQuery<ConsentLink[], ApiError>({
    queryKey: keys.consent.links(projectUuid ?? ""),
    queryFn: () => listProjectLinks(projectUuid!),
    enabled: Boolean(projectUuid),
  });
}

export function useAllLinks(filters: ListFilters = {}) {
  return useQuery<Page<LinkListRow>, ApiError>({
    queryKey: keys.consent.allLinks(filters),
    queryFn: () => listLinks(filters),
  });
}

export function useLinkStats(uuid: Uuid | undefined) {
  return useQuery<LinkStats, ApiError>({
    queryKey: keys.consent.linkStats(uuid ?? ""),
    queryFn: () => getLinkStats(uuid!),
    enabled: Boolean(uuid),
  });
}
