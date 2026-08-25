/**
 * Reading purposes, processors and data sources.
 */
"use client";

import { useQuery } from "@tanstack/react-query";

import {
  getPurpose,
  getPurposeUsage,
  listProcessors,
  listPurposeVersions,
  listPurposes,
  listSources,
  type PurposeUsage,
} from "@/features/registry/api";
import type { ApiError } from "@/lib/errors";
import { keys } from "@/lib/query";
import type { DataSource, Page, Processor, Purpose, Uuid } from "@/types";

export function usePurposes(filters: Record<string, unknown> = {}) {
  return useQuery<Page<Purpose>, ApiError>({
    queryKey: keys.registry.purposes(filters),
    queryFn: () => listPurposes(filters),
  });
}

export function usePurpose(uuid: Uuid | undefined) {
  return useQuery<Purpose, ApiError>({
    queryKey: keys.registry.purpose(uuid ?? ""),
    queryFn: () => getPurpose(uuid!),
    enabled: Boolean(uuid),
  });
}

/** Which notices reference a purpose - how the UI knows retirement is blocked
 *  before the user tries it. */
export function usePurposeUsage(uuid: Uuid | undefined) {
  return useQuery<PurposeUsage, ApiError>({
    queryKey: keys.registry.purposeUsage(uuid ?? ""),
    queryFn: () => getPurposeUsage(uuid!),
    enabled: Boolean(uuid),
  });
}

export function useProcessors(filters: Record<string, unknown> = {}) {
  return useQuery<Page<Processor>, ApiError>({
    queryKey: keys.registry.processors(filters),
    queryFn: () => listProcessors(filters),
  });
}

export function useSources(filters: Record<string, unknown> = {}) {
  return useQuery<Page<DataSource>, ApiError>({
    queryKey: keys.registry.sources(filters),
    queryFn: () => listSources(filters),
  });
}

export function usePurposeVersions(uuid: Uuid | undefined) {
  return useQuery<Purpose[], ApiError>({
    queryKey: keys.registry.purposeVersions(uuid ?? ""),
    queryFn: () => listPurposeVersions(uuid!),
    enabled: Boolean(uuid),
    // DPO and admin only. A 403 is the answer, not a hiccup worth retrying.
    retry: false,
  });
}
