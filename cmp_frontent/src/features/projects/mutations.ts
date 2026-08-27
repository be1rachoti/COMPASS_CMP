/**
 * Writing projects, sites, agent assignments and approvals.
 *
 * The request is in `api.ts`; what each hook owns is **what the write
 * invalidates**. That is the part worth reading closely, and the part that goes
 * wrong: a create that does not invalidate its list leaves somebody looking at
 * a screen that does not show the thing they just made, and the usual "fix" is
 * a page reload, which hides the bug rather than removing it.
 *
 * No mutation retries. These write to append-only tables — a retried export
 * would produce a second set of `export_line` rows and corrupt the disclosure
 * record — and the shared query client sets `retry: false` for mutations. It is
 * restated here because it is load-bearing, not incidental.
 */
"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";

import {
  assignAgent,
  decideProjectProcessor,
  requestProjectProcessor,
  setProjectProcessors,
  assignSiteOwner,
  assignSiteSource,
  closeProject,
  createProject,
  createSite,
  deactivateSite,
  requestTransition,
  updateProject,
  updateSite,
  uploadApproval,
  type AgentInput,
  type ApprovalUpload,
  type MintedLink,
  type ProjectInput,
  type SiteInput,
  type TransitionInput,
  type TransitionResult,
} from "@/features/projects/api";
import { keys, prefixes, type Result } from "@/lib/query";
import type {
  Acknowledged,
  Project,
  ProcessorDecision,
  ProjectProcessor,
  Site,
  SiteSourceAssigned,
  Uuid,
} from "@/types";

export type {
  AgentInput,
  ApprovalUpload,
  MintedLink,
  ProjectInput,
  SiteInput,
  TransitionInput,
};

/**
 * A lifecycle transition.
 *
 * Invalidates broadly on purpose: a transition can publish a notice, move the
 * project between queues, change which transitions are available next, and
 * alter the dashboard's counts. Enumerating those precisely is how one gets
 * forgotten.
 */
export function useTransition(projectUuid: Uuid): Result<TransitionResult, TransitionInput> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: TransitionInput) => requestTransition(projectUuid, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.project.detail(projectUuid) });
      void qc.invalidateQueries({ queryKey: keys.project.list() });
      void qc.invalidateQueries({ queryKey: keys.dashboard.all });
    },
  });
}

export function useCreateProject(): Result<Project, ProjectInput> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createProject,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.project.list() });
      void qc.invalidateQueries({ queryKey: keys.dashboard.all });
    },
  });
}

export function useUpdateProject(uuid: Uuid): Result<Project, Partial<ProjectInput>> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Partial<ProjectInput>) => updateProject(uuid, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.project.detail(uuid) });
      void qc.invalidateQueries({ queryKey: keys.project.list() });
    },
  });
}

/**
 * Change who will collect, while the project is still in draft.
 *
 * Invalidates the detail *and* the list because the processors decide the
 * routing: swapping a third party for an in-house team moves the project out
 * of every DCO Admin's queue, and a stale list would keep offering it.
 */
/**
 * Ask for a collector to be added.
 *
 * Invalidates the project prefix rather than just the processor list, because
 * on a draft this changes the routing immediately, and on an approved project
 * it puts something on the DPO's queue.
 */
export function useRequestProcessor(uuid: Uuid): Result<ProcessorDecision, Uuid> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (processorUuid: Uuid) => requestProjectProcessor(uuid, processorUuid),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: prefixes.anyProject });
      void qc.invalidateQueries({ queryKey: keys.dashboard.all });
    },
  });
}

/**
 * The DPO's decision on one requested collector.
 *
 * Also invalidates the cross-project site list: approving one makes its sources
 * deployable, which changes what the site screens can offer.
 */
export function useDecideProcessor(
  uuid: Uuid,
): Result<ProcessorDecision, { processorUuid: Uuid; approved: boolean; reason?: string | null }> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      processorUuid,
      approved,
      reason,
    }: {
      processorUuid: Uuid;
      approved: boolean;
      reason?: string | null;
    }) => decideProjectProcessor(uuid, processorUuid, { approved, reason }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: prefixes.anyProject });
      void qc.invalidateQueries({ queryKey: keys.project.allSites() });
      void qc.invalidateQueries({ queryKey: keys.dashboard.all });
    },
  });
}

export function useSetProcessors(uuid: Uuid): Result<ProjectProcessor[], string[]> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (processorUuids: string[]) => setProjectProcessors(uuid, processorUuids),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: prefixes.anyProject });
      void qc.invalidateQueries({ queryKey: keys.project.list() });
    },
  });
}

export function useCloseProject(uuid: Uuid): Result<Acknowledged, { reason?: string }> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { reason?: string }) => closeProject(uuid, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.project.detail(uuid) });
      void qc.invalidateQueries({ queryKey: keys.project.list() });
      void qc.invalidateQueries({ queryKey: keys.dashboard.all });
    },
  });
}

export function useCreateSite(projectUuid: Uuid): Result<Site, SiteInput> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: SiteInput) => createSite(projectUuid, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.project.sites(projectUuid) });
      void qc.invalidateQueries({ queryKey: keys.project.allSites() });
    },
  });
}

export function useUpdateSite(uuid: Uuid): Result<Site, Partial<SiteInput>> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Partial<SiteInput>) => updateSite(uuid, body),
    onSuccess: () => {
      // The site's own project is not known here, so invalidate the prefix
      // rather than guess. One extra refetch beats a stale row.
      void qc.invalidateQueries({ queryKey: prefixes.anyProject });
      void qc.invalidateQueries({ queryKey: keys.project.allSites() });
    },
  });
}

export function useDeactivateSite(): Result<Acknowledged, Uuid> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: deactivateSite,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: prefixes.anyProject });
      void qc.invalidateQueries({ queryKey: keys.project.allSites() });
    },
  });
}

export function useAssignAgent(siteUuid: Uuid): Result<MintedLink, AgentInput> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: AgentInput) => assignAgent(siteUuid, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: prefixes.anyProject });
      void qc.invalidateQueries({ queryKey: keys.consent.allLinks() });
    },
  });
}

/**
 * Upload an approval with its proof.
 *
 * The third invalidation is the one that is easy to miss: an approval with
 * proof unblocks `in_draft -> pending_approval`, so the transition view is
 * stale the moment this succeeds. Without it the user uploads a document and
 * the button they were trying to unblock stays disabled.
 */
export function useUploadApproval(projectUuid: Uuid): Result<unknown, ApprovalUpload> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ApprovalUpload) => uploadApproval(projectUuid, input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.project.approvals(projectUuid) });
      void qc.invalidateQueries({ queryKey: keys.project.allApprovals() });
      void qc.invalidateQueries({ queryKey: keys.project.transitions(projectUuid) });
    },
  });
}

/**
 * Attach the data source that stands at a site, and let the project follow.
 *
 * Invalidates the project prefix *and* the cross-project list, because this can
 * remove a project from the caller's own scope: a DCO Admin attaching a source
 * sees no change, but the DCO who owns that source would find a project
 * appear — and the DCO who owned the previous one would find it gone. A stale
 * list showing it would produce a 404 on the next click.
 */
/**
 * Name who runs one site. The rig, and every other project on it, is untouched.
 *
 * Invalidates the same keys as attaching a source, because the consequence is
 * the same shape: this project can enter or leave somebody's list. It does
 * *not* invalidate the sources registry — nothing there changed, and saying it
 * did would suggest the rig had moved.
 */
export function useAssignSiteOwner(): Result<
  SiteSourceAssigned,
  { siteUuid: Uuid; ownerUserUuid: Uuid | null }
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ siteUuid, ownerUserUuid }: { siteUuid: Uuid; ownerUserUuid: Uuid | null }) =>
      assignSiteOwner(siteUuid, ownerUserUuid),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: prefixes.anyProject });
      void qc.invalidateQueries({ queryKey: keys.project.list() });
      void qc.invalidateQueries({ queryKey: keys.project.allSites() });
      void qc.invalidateQueries({ queryKey: keys.dashboard.all });
    },
  });
}

export function useAssignSiteSource(): Result<
  SiteSourceAssigned,
  { siteUuid: Uuid; sourceUuid: Uuid | null }
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ siteUuid, sourceUuid }: { siteUuid: Uuid; sourceUuid: Uuid | null }) =>
      assignSiteSource(siteUuid, sourceUuid),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: prefixes.anyProject });
      void qc.invalidateQueries({ queryKey: keys.project.list() });
      void qc.invalidateQueries({ queryKey: keys.project.allSites() });
      void qc.invalidateQueries({ queryKey: keys.dashboard.all });
    },
  });
}
