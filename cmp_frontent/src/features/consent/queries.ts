/**
 * Reading consent links, artefacts and grants.
 */
"use client";

import { useQuery } from "@tanstack/react-query";
import { apiGet, queryString } from "@/lib/api";
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
    queryFn: () =>
      apiGet<Page<ConsentRow>>(`/projects/${projectUuid}/consents${queryString(filters)}`),
    enabled: Boolean(projectUuid),
  });
}

export function useConsentSummary(projectUuid: Uuid | undefined) {
  return useQuery<Record<string, number>, ApiError>({
    queryKey: keys.consent.summary(projectUuid ?? ""),
    queryFn: () => apiGet(`/projects/${projectUuid}/consents/summary`),
    enabled: Boolean(projectUuid),
  });
}

export function useLinks(projectUuid: Uuid | undefined) {
  return useQuery<ConsentLink[], ApiError>({
    queryKey: keys.consent.links(projectUuid ?? ""),
    queryFn: () => apiGet<ConsentLink[]>(`/projects/${projectUuid}/links`),
    enabled: Boolean(projectUuid),
  });
}

export function useLinkStats(uuid: Uuid | undefined) {
  return useQuery<LinkStats, ApiError>({
    queryKey: keys.consent.linkStats(uuid ?? ""),
    queryFn: () => apiGet<LinkStats>(`/links/${uuid}/stats`),
    enabled: Boolean(uuid),
  });
}

export function useAllLinks(filters: ListFilters = {}) {
  return useQuery<Page<LinkListRow>, ApiError>({
    queryKey: keys.consent.allLinks(filters),
    queryFn: () => apiGet<Page<LinkListRow>>(`/links${queryString(filters)}`),
  });
}

export function useAllConsents(filters: ListFilters = {}) {
  return useQuery<Page<ConsentListRow>, ApiError>({
    queryKey: keys.consent.all(filters),
    queryFn: () => apiGet<Page<ConsentListRow>>(`/consents${queryString(filters)}`),
  });
}

/**
 * One consent record, staff view.
 *
 * Three calls rather than one fat endpoint: the artefact is cheap and always
 * wanted, the grants are cheap and almost always wanted, and the asset reverse
 * lookup is the expensive one that only matters when somebody is answering an
 * erasure request. Splitting them means the page paints before the third
 * returns.
 */
export function useConsent(uuid: Uuid | undefined) {
  return useQuery<ConsentArtefact, ApiError>({
    queryKey: keys.consent.detail(uuid ?? ""),
    queryFn: () => apiGet<ConsentArtefact>(`/consents/${uuid}`),
    enabled: Boolean(uuid),
  });
}

export function useConsentGrants(uuid: Uuid | undefined) {
  return useQuery<PurposeGrant[], ApiError>({
    queryKey: keys.consent.grants(uuid ?? ""),
    queryFn: () => apiGet<PurposeGrant[]>(`/consents/${uuid}/grants`),
    enabled: Boolean(uuid),
  });
}

export function useConsentAssets(uuid: Uuid | undefined) {
  return useQuery<ConsentAsset[], ApiError>({
    queryKey: keys.consent.assets(uuid ?? ""),
    queryFn: () => apiGet<ConsentAsset[]>(`/consents/${uuid}/assets`),
    enabled: Boolean(uuid),
    // A 403 here is a scope answer, not a transient failure. Retrying it just
    // writes more access-denial rows into the audit trail.
    retry: false,
  });
}
