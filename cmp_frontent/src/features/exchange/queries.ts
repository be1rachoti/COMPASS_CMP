/**
 * Reading exports, imports, collections and their assets.
 */
"use client";

import { useQuery } from "@tanstack/react-query";
import { apiGet, queryString } from "@/lib/api";
import type { ApiError } from "@/lib/errors";
import { keys, type ListFilters } from "@/lib/query";
import type {
  Collection,
  CollectionAsset,
  CollectionDetail,
  CollectionExceptions,
  CollectionListRow,
  ExportListRow,
  ExportRecord,
  ImportBatch,
  ImportBatchDetail,
  ImportErrorReport,
  Page,
  Uuid,
} from "@/types";

export function useExports(projectUuid: Uuid | undefined) {
  return useQuery<ExportRecord[], ApiError>({
    queryKey: keys.exchange.exports(projectUuid ?? ""),
    queryFn: () => apiGet<ExportRecord[]>(`/projects/${projectUuid}/exports`),
    enabled: Boolean(projectUuid),
  });
}

export function useImports(filters: Record<string, unknown> = {}) {
  return useQuery<Page<ImportBatch>, ApiError>({
    queryKey: keys.exchange.imports(filters),
    queryFn: () => apiGet<Page<ImportBatch>>(`/imports${queryString(filters)}`),
  });
}

export function useCollections(projectUuid: Uuid | undefined) {
  return useQuery<Page<Collection>, ApiError>({
    queryKey: keys.exchange.collections(projectUuid ?? ""),
    queryFn: () => apiGet<Page<Collection>>(`/projects/${projectUuid}/collections`),
    enabled: Boolean(projectUuid),
  });
}

export function useCollectionExceptions(uuid: Uuid | undefined) {
  return useQuery<CollectionExceptions, ApiError>({
    queryKey: keys.exchange.collectionExceptions(uuid ?? ""),
    queryFn: () => apiGet<CollectionExceptions>(`/collections/${uuid}/exceptions`),
    enabled: Boolean(uuid),
  });
}

export function useCollection(uuid: Uuid | undefined) {
  return useQuery<CollectionDetail, ApiError>({
    queryKey: keys.exchange.collection(uuid ?? ""),
    queryFn: () => apiGet<CollectionDetail>(`/collections/${uuid}`),
    enabled: Boolean(uuid),
  });
}

export function useCollectionAssets(uuid: Uuid | undefined) {
  return useQuery<CollectionAsset[], ApiError>({
    queryKey: keys.exchange.collectionAssets(uuid ?? ""),
    queryFn: () => apiGet<CollectionAsset[]>(`/collections/${uuid}/assets`),
    enabled: Boolean(uuid),
  });
}

export function useImportBatch(uuid: Uuid | undefined) {
  return useQuery<ImportBatchDetail, ApiError>({
    queryKey: keys.exchange.importBatch(uuid ?? ""),
    queryFn: () => apiGet<ImportBatchDetail>(`/imports/${uuid}`),
    enabled: Boolean(uuid),
  });
}

export function useImportErrors(uuid: Uuid | undefined) {
  return useQuery<ImportErrorReport, ApiError>({
    queryKey: keys.exchange.importErrors(uuid ?? ""),
    queryFn: () => apiGet<ImportErrorReport>(`/imports/${uuid}/errors`),
    enabled: Boolean(uuid),
  });
}

export function useAllExports(filters: ListFilters = {}) {
  return useQuery<Page<ExportListRow>, ApiError>({
    queryKey: keys.exchange.allExports(filters),
    queryFn: () => apiGet<Page<ExportListRow>>(`/exports${queryString(filters)}`),
  });
}

export function useAllCollections(filters: ListFilters = {}) {
  return useQuery<Page<CollectionListRow>, ApiError>({
    queryKey: keys.exchange.allCollections(filters),
    queryFn: () => apiGet<Page<CollectionListRow>>(`/collections${queryString(filters)}`),
  });
}
