/**
 * Reading purposes, processors and data sources.
 */
"use client";

import { useQuery } from "@tanstack/react-query";
import { apiGet, queryString } from "@/lib/api";
import type { ApiError } from "@/lib/errors";
import { keys } from "@/lib/query";
import type { DataSource, Page, Processor, Purpose, PurposeUsageEntry, Uuid } from "@/types";

export function usePurposes(filters: Record<string, unknown> = {}) {
  return useQuery<Page<Purpose>, ApiError>({
    queryKey: keys.registry.purposes(filters),
    queryFn: () => apiGet<Page<Purpose>>(`/purposes${queryString(filters)}`),
  });
}

export function usePurpose(uuid: Uuid | undefined) {
  return useQuery<Purpose, ApiError>({
    queryKey: keys.registry.purpose(uuid ?? ""),
    queryFn: () => apiGet<Purpose>(`/purposes/${uuid}`),
    enabled: Boolean(uuid),
  });
}

/** Which notices reference a purpose - how the UI knows retirement is blocked
 *  before the user tries it. */
export function usePurposeUsage(uuid: Uuid | undefined) {
  return useQuery<{ items: PurposeUsageEntry[]; retirable: boolean; total: number }, ApiError>({
    queryKey: keys.registry.purposeUsage(uuid ?? ""),
    queryFn: () => apiGet(`/purposes/${uuid}/usage`),
    enabled: Boolean(uuid),
  });
}

export function useProcessors(filters: Record<string, unknown> = {}) {
  return useQuery<Page<Processor>, ApiError>({
    queryKey: keys.registry.processors(filters),
    queryFn: () => apiGet<Page<Processor>>(`/processors${queryString(filters)}`),
  });
}

export function useSources(filters: Record<string, unknown> = {}) {
  return useQuery<Page<DataSource>, ApiError>({
    queryKey: keys.registry.sources(filters),
    queryFn: () => apiGet<Page<DataSource>>(`/sources${queryString(filters)}`),
  });
}

export function usePurposeVersions(uuid: Uuid | undefined) {
  return useQuery<Purpose[], ApiError>({
    queryKey: keys.registry.purposeVersions(uuid ?? ""),
    queryFn: () => apiGet<Purpose[]>(`/purposes/${uuid}/versions`),
    enabled: Boolean(uuid),
    // DPO and admin only. A 403 is the answer, not a hiccup worth retrying.
    retry: false,
  });
}
