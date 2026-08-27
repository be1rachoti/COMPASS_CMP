/**
 * Every request the exchange feature makes — data leaving and data arriving.
 *
 * Both directions are validated more carefully than an ordinary form because
 * the failure modes are asymmetric. A rejected import is obvious and gets
 * fixed; the dangerous outcome is a manifest accepted with rows nobody is
 * looking at, which is why `unaccounted` exists on the collection views.
 */

import { apiDownload, apiGet, apiPost, http, queryString } from "@/lib/api";
import type { ListFilters } from "@/lib/query";
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
  ImportValidation,
  Page,
  Uuid,
} from "@/types";

/* ----------------------------------------------------------------- reads */

export function listProjectExports(projectUuid: Uuid): Promise<ExportRecord[]> {
  return apiGet<ExportRecord[]>(`/projects/${projectUuid}/exports`);
}

export function listExports(filters: ListFilters = {}): Promise<Page<ExportListRow>> {
  return apiGet<Page<ExportListRow>>(`/exports${queryString(filters)}`);
}

export function listImports(filters: Record<string, unknown> = {}): Promise<Page<ImportBatch>> {
  return apiGet<Page<ImportBatch>>(`/imports${queryString(filters)}`);
}

export function getImportBatch(uuid: Uuid): Promise<ImportBatchDetail> {
  return apiGet<ImportBatchDetail>(`/imports/${uuid}`);
}

/** The rejected rows and why each was rejected. */
export function getImportErrors(uuid: Uuid): Promise<ImportErrorReport> {
  return apiGet<ImportErrorReport>(`/imports/${uuid}/errors`);
}

export function listProjectCollections(projectUuid: Uuid): Promise<Page<Collection>> {
  return apiGet<Page<Collection>>(`/projects/${projectUuid}/collections`);
}

export function listCollections(filters: ListFilters = {}): Promise<Page<CollectionListRow>> {
  return apiGet<Page<CollectionListRow>>(`/collections${queryString(filters)}`);
}

export function getCollection(uuid: Uuid): Promise<CollectionDetail> {
  return apiGet<CollectionDetail>(`/collections/${uuid}`);
}

export function listCollectionAssets(uuid: Uuid): Promise<CollectionAsset[]> {
  return apiGet<CollectionAsset[]>(`/collections/${uuid}/assets`);
}

/**
 * Declared minus mapped, and the assets in between.
 *
 * The number that matters in this whole feature: 500 declared, 480 mapped, and
 * twenty assets in a state nobody is accountable for.
 */
export function getCollectionExceptions(uuid: Uuid): Promise<CollectionExceptions> {
  return apiGet<CollectionExceptions>(`/collections/${uuid}/exceptions`);
}

/* ---------------------------------------------------------------- writes */

export interface ExportCreated {
  export_uuid: Uuid;
  row_count: number;
}

export interface ManifestUpload {
  source: string;
  project?: string;
  manifest: File;
}

export interface ImportSubmitted {
  batch_uuid: Uuid;
  status: string;
  accepted_rows: number;
  rejected_rows: number;
}

/**
 * Generate the project's export. No body: there is one kind and it covers the
 * project. What it contains follows the caller's own scope, decided server-side.
 */
export function createExport(projectUuid: Uuid): Promise<ExportCreated> {
  return apiPost<ExportCreated>(`/projects/${projectUuid}/exports`, {});
}

/**
 * The multipart body both import endpoints take.
 *
 * Built here rather than at each call site so the two cannot drift — a dry run
 * that sends a different payload from the real submission tests nothing.
 * Content-Type is deliberately unset: the browser adds the boundary itself, and
 * the API client strips its JSON default when it sees FormData.
 */
function manifestBody(input: ManifestUpload): FormData {
  const body = new FormData();
  body.append("source", input.source);
  if (input.project) body.append("project", input.project);
  body.append("manifest", input.manifest);
  return body;
}

/**
 * Dry run. Same parsing, same checks, nothing written.
 *
 * A manifest from a third-party capture tool is the input this system trusts
 * least, and finding out after a partial write is worse than finding out
 * before.
 */
export async function validateImport(input: ManifestUpload): Promise<ImportValidation> {
  const { data } = await http.post<ImportValidation>("/imports/validate", manifestBody(input));
  return data;
}

export async function submitImport(input: ManifestUpload): Promise<ImportSubmitted> {
  const { data } = await http.post<ImportSubmitted>("/imports", manifestBody(input));
  return data;
}

/**
 * Download a generated export.
 *
 * The staleness metadata is not decoration. A consented list is true at the
 * moment it was generated; withdrawals since then are not in it, and somebody
 * about to send that file to a processor needs to know how old it is.
 */
export function downloadExport(uuid: Uuid) {
  return apiDownload(`/exports/${uuid}/download`);
}

/**
 * The manifest template: a CSV carrying its own instructions.
 *
 * Header, one worked example, and per-column guidance prefixed `#`, which the
 * parser skips — so the guidance survives a round trip through Excel rather
 * than becoming five rows of "required value is empty".
 */
export function downloadManifestTemplate() {
  return apiDownload("/imports/template");
}
