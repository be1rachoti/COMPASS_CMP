/**
 * Writing registry entries. Nothing here deletes.
 */
"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";

import {
  activatePurpose,
  assignSourceOwner,
  createProcessor,
  createPurpose,
  createSource,
  retirePurpose,
  type ProcessorInput,
  type PurposeInput,
  type SourceInput,
  type SourceOwnerAssigned,
  suspendProcessor,
  suspendSource,
  updateProcessor,
  updatePurpose,
  updateSource,
} from "@/features/registry/api";
import type { ApiError } from "@/lib/errors";
import { keys, prefixes, type Result } from "@/lib/query";
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

/**
 * Hand a source to somebody, and let every project using it follow.
 *
 * Invalidates the project prefix as well as the source list, because that is
 * the reach of it: the server re-derives the routing of every project deploying
 * this source, so a project list left alone would keep showing the previous
 * owner's world.
 */
export function useAssignSourceOwner(): Result<
  SourceOwnerAssigned,
  { sourceUuid: Uuid; ownerUserUuid: Uuid | null }
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ sourceUuid, ownerUserUuid }: { sourceUuid: Uuid; ownerUserUuid: Uuid | null }) =>
      assignSourceOwner(sourceUuid, ownerUserUuid),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["sources"] });
      void qc.invalidateQueries({ queryKey: prefixes.anyProject });
      void qc.invalidateQueries({ queryKey: keys.project.list() });
      void qc.invalidateQueries({ queryKey: keys.dashboard.all });
    },
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
