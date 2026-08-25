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
  assignDco,
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
import type { Acknowledged, Project, Site, Uuid } from "@/types";

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

export function useAssignDco(uuid: Uuid): Result<Acknowledged, { dco_user_uuid: string }> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { dco_user_uuid: string }) => assignDco(uuid, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.project.detail(uuid) });
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
 * proof unblocks `under_process -> pending_approval`, so the transition view is
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
