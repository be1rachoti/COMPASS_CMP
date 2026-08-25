/**
 * Reading exports, imports, collections and their assets.
 */
"use client";

import { useQuery } from "@tanstack/react-query";

import {
  getCollection,
  getCollectionExceptions,
  getImportBatch,
  getImportErrors,
  listCollectionAssets,
  listCollections,
  listExports,
  listImports,
  listProjectCollections,
  listProjectExports,
} from "@/features/exchange/api";
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
    queryFn: () => listProjectExports(projectUuid!),
    enabled: Boolean(projectUuid),
  });
}

export function useImports(filters: Record<string, unknown> = {}) {
  return useQuery<Page<ImportBatch>, ApiError>({
    queryKey: keys.exchange.imports(filters),
    queryFn: () => listImports(filters),
  });
}

export function useCollections(projectUuid: Uuid | undefined) {
  return useQuery<Page<Collection>, ApiError>({
    queryKey: keys.exchange.collections(projectUuid ?? ""),
    queryFn: () => listProjectCollections(projectUuid!),
    enabled: Boolean(projectUuid),
  });
}

export function useCollectionExceptions(uuid: Uuid | undefined) {
  return useQuery<CollectionExceptions, ApiError>({
    queryKey: keys.exchange.collectionExceptions(uuid ?? ""),
    queryFn: () => getCollectionExceptions(uuid!),
    enabled: Boolean(uuid),
  });
}

export function useCollection(uuid: Uuid | undefined) {
  return useQuery<CollectionDetail, ApiError>({
    queryKey: keys.exchange.collection(uuid ?? ""),
    queryFn: () => getCollection(uuid!),
    enabled: Boolean(uuid),
  });
}

export function useCollectionAssets(uuid: Uuid | undefined) {
  return useQuery<CollectionAsset[], ApiError>({
    queryKey: keys.exchange.collectionAssets(uuid ?? ""),
    queryFn: () => listCollectionAssets(uuid!),
    enabled: Boolean(uuid),
  });
}

export function useImportBatch(uuid: Uuid | undefined) {
  return useQuery<ImportBatchDetail, ApiError>({
    queryKey: keys.exchange.importBatch(uuid ?? ""),
    queryFn: () => getImportBatch(uuid!),
    enabled: Boolean(uuid),
  });
}

export function useImportErrors(uuid: Uuid | undefined) {
  return useQuery<ImportErrorReport, ApiError>({
    queryKey: keys.exchange.importErrors(uuid ?? ""),
    queryFn: () => getImportErrors(uuid!),
    enabled: Boolean(uuid),
  });
}

export function useAllExports(filters: ListFilters = {}) {
  return useQuery<Page<ExportListRow>, ApiError>({
    queryKey: keys.exchange.allExports(filters),
    queryFn: () => listExports(filters),
  });
}

export function useAllCollections(filters: ListFilters = {}) {
  return useQuery<Page<CollectionListRow>, ApiError>({
    queryKey: keys.exchange.allCollections(filters),
    queryFn: () => listCollections(filters),
  });
}
