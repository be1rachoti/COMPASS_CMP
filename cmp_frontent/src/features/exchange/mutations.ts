/**
 * Creating exports and submitting import manifests.
 */
"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiPost, http } from "@/lib/api";
import type { ApiError } from "@/lib/errors";
import { keys, type Result } from "@/lib/query";
import type { ExportRecord, ImportValidation, Uuid } from "@/types";

export function useGenerateExport(projectUuid: Uuid) {
  const qc = useQueryClient();
  return useMutation<ExportRecord, ApiError, { type: string; site: Uuid }>({
    mutationFn: (body) => apiPost<ExportRecord>(`/projects/${projectUuid}/exports`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.exchange.exports(projectUuid) }),
  });
}

export function useCreateExport(
  projectUuid: Uuid,
): Result<{ export_uuid: Uuid; row_count: number }, { type: string; site: string }> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body) => apiPost(`/projects/${projectUuid}/exports`, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["all", "exports"] });
      void qc.invalidateQueries({ queryKey: ["project", projectUuid] });
    },
  });
}

export interface ManifestUpload {
  source: string;
  project?: string;
  manifest: File;
}

/**
 * Dry run. Same parsing, same checks, nothing written.
 *
 * A manifest arriving from a third-party tool is the input you trust least, and
 * finding out after a partial write is worse than finding out before.
 */
export function useValidateImport(): Result<ImportValidation, ManifestUpload> {
  return useMutation({
    mutationFn: async (input) => {
      const body = new FormData();
      body.append("source", input.source);
      if (input.project) body.append("project", input.project);
      body.append("manifest", input.manifest);
      const { data } = await http.post<ImportValidation>("/imports/validate", body);
      return data;
    },
  });
}

export function useSubmitImport(): Result<
  { batch_uuid: Uuid; status: string; accepted_rows: number; rejected_rows: number },
  ManifestUpload
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input) => {
      const body = new FormData();
      body.append("source", input.source);
      if (input.project) body.append("project", input.project);
      body.append("manifest", input.manifest);
      const { data } = await http.post("/imports", body);
      return data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.exchange.imports() });
      void qc.invalidateQueries({ queryKey: keys.exchange.allCollections() });
    },
  });
}
