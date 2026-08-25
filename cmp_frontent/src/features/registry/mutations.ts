/**
 * Writing registry entries. Nothing here deletes.
 */
"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiPost, apiPut } from "@/lib/api";
import type { ApiError } from "@/lib/errors";
import type { Result } from "@/lib/query";
import type { Processor, Purpose, Uuid } from "@/types";

export function useActivatePurpose() {
  const qc = useQueryClient();
  return useMutation<{ ok: boolean; message?: string }, ApiError, Uuid>({
    mutationFn: (uuid) => apiPost(`/purposes/${uuid}/activate`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["purposes"] }),
  });
}

export function useRetirePurpose() {
  const qc = useQueryClient();
  return useMutation<{ ok: boolean; message?: string }, ApiError, Uuid>({
    mutationFn: (uuid) => apiPost(`/purposes/${uuid}/retire`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["purposes"] }),
  });
}

export function useSuspendProcessor() {
  const qc = useQueryClient();
  return useMutation<{ ok: boolean; message?: string }, ApiError, Uuid>({
    mutationFn: (uuid) => apiPost(`/processors/${uuid}/suspend`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["processors"] }),
  });
}

export function useSuspendSource() {
  const qc = useQueryClient();
  return useMutation<{ ok: boolean; message?: string }, ApiError, Uuid>({
    mutationFn: (uuid) => apiPost(`/sources/${uuid}/suspend`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["sources"] }),
  });
}

export interface PurposeInput {
  purpose_code: string;
  name: string;
  description: string;
  uses: string;
  lawful_basis: string;
  s7_clause?: string | null;
  data_categories: string[];
  retention_days: number;
  retention_basis: string;
  erasure_trigger: string;
  consent_validity_days?: number | null;
  cross_border_permitted: boolean;
  permitted_for_minors: boolean;
  lapse_behaviour: string;
}

export function useCreatePurpose(): Result<Purpose, PurposeInput> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body) => apiPost<Purpose>("/purposes", body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["purposes"] }),
  });
}

export function useUpdatePurpose(uuid: Uuid): Result<Purpose, Partial<PurposeInput>> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body) => apiPut<Purpose>(`/purposes/${uuid}`, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["purposes"] });
      void qc.invalidateQueries({ queryKey: ["purpose", uuid] });
    },
  });
}

export interface ProcessorInput {
  legal_name: string;
  type: string;
  contract_ref: string;
  security_confirmed_at: string;
}

export function useCreateProcessor(): Result<Processor, ProcessorInput> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body) => apiPost<Processor>("/processors", body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["processors"] }),
  });
}

export function useUpdateProcessor(uuid: Uuid): Result<Processor, Partial<ProcessorInput>> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body) => apiPut<Processor>(`/processors/${uuid}`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["processors"] }),
  });
}

export interface SourceInput {
  source_code: string;
  name: string;
  source_role: string;
  exchange_mode: string;
  id_scheme?: string | null;
  processor_uuid?: string | null;
  site_uuid?: string | null;
  is_authoritative_for: string[];
}

export function useCreateSource(): Result<unknown, SourceInput> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body) => apiPost("/sources", body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["sources"] }),
  });
}

export function useUpdateSource(uuid: Uuid): Result<unknown, Partial<SourceInput>> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body) => apiPut(`/sources/${uuid}`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["sources"] }),
  });
}
