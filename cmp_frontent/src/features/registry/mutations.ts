/**
 * Writing registry entries. Nothing here deletes.
 */
"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";

import {

  activatePurpose,
  createProcessor,
  createPurpose,
  createSource,
  retirePurpose,
  suspendProcessor,
  suspendSource,
  type ProcessorInput,
  type PurposeInput,
  type SourceInput,
  updateProcessor,
  updatePurpose,
  updateSource,
} from "@/features/registry/api";
import type { ApiError } from "@/lib/errors";
import type { Result } from "@/lib/query";
import type { Acknowledged, Processor, Purpose, Uuid } from "@/types";


export function useActivatePurpose() {
  const qc = useQueryClient();
  return useMutation<Acknowledged, ApiError, Uuid>({
    mutationFn: activatePurpose,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["purposes"] }),
  });
}

export function useRetirePurpose() {
  const qc = useQueryClient();
  return useMutation<Acknowledged, ApiError, Uuid>({
    mutationFn: retirePurpose,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["purposes"] }),
  });
}

export function useSuspendProcessor() {
  const qc = useQueryClient();
  return useMutation<Acknowledged, ApiError, Uuid>({
    mutationFn: suspendProcessor,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["processors"] }),
  });
}

export function useSuspendSource() {
  const qc = useQueryClient();
  return useMutation<Acknowledged, ApiError, Uuid>({
    mutationFn: suspendSource,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["sources"] }),
  });
}

export function useCreatePurpose(): Result<Purpose, PurposeInput> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createPurpose,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["purposes"] }),
  });
}

export function useUpdatePurpose(uuid: Uuid): Result<Purpose, Partial<PurposeInput>> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Partial<PurposeInput>) => updatePurpose(uuid, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["purposes"] });
      void qc.invalidateQueries({ queryKey: ["purpose", uuid] });
    },
  });
}

export function useCreateProcessor(): Result<Processor, ProcessorInput> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createProcessor,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["processors"] }),
  });
}

export function useUpdateProcessor(uuid: Uuid): Result<Processor, Partial<ProcessorInput>> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Partial<ProcessorInput>) => updateProcessor(uuid, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["processors"] }),
  });
}

export function useCreateSource(): Result<unknown, SourceInput> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createSource,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["sources"] }),
  });
}

export function useUpdateSource(uuid: Uuid): Result<unknown, Partial<SourceInput>> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Partial<SourceInput>) => updateSource(uuid, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["sources"] }),
  });
}
