/**
 * Creating exports and submitting import manifests.
 *
 * Both write to append-only tables, which is why nothing here retries: a
 * retried export would produce a second set of `export_line` rows and corrupt
 * the disclosure record that answers "who was my data shared with".
 */
"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";

import {
  createExport,
  submitImport,
  validateImport,
  type ExportCreated,
  type ImportSubmitted,
  type ManifestUpload,
} from "@/features/exchange/api";
import { keys, prefixes, type Result } from "@/lib/query";
import type { Uuid } from "@/types";

/**
 * Generate an export for one project.
 *
 * Invalidates the cross-project export list as well as the project's own: a new
 * export is a new disclosure, and the console-wide list is the one a DPO
 * watches.
 */
export function useCreateExport(projectUuid: Uuid): Result<ExportCreated, void> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => createExport(projectUuid),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.exchange.exports(projectUuid) });
      void qc.invalidateQueries({ queryKey: keys.exchange.allExports() });
      void qc.invalidateQueries({ queryKey: keys.project.detail(projectUuid) });
    },
  });
}

/**
 * Dry run. Same parsing, same checks, nothing written.
 *
 * No invalidation, because nothing changed — that is the whole point of the
 * endpoint. A manifest from a third-party capture tool is the input this system
 * trusts least, and finding out after a partial write is worse than finding out
 * before.
 */
export function useValidateImport(): Result<
  Awaited<ReturnType<typeof validateImport>>,
  ManifestUpload
> {
  return useMutation({ mutationFn: validateImport });
}

export function useSubmitImport(): Result<ImportSubmitted, ManifestUpload> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: submitImport,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.exchange.imports() });
      void qc.invalidateQueries({ queryKey: keys.exchange.allCollections() });
      // A collection belongs to a project, and which one is in the manifest
      // rather than in hand here.
      void qc.invalidateQueries({ queryKey: prefixes.anyProject });
    },
  });
}
