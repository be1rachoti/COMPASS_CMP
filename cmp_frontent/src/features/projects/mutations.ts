/**
 * Writing projects, sites, agent assignments and approvals.
 */
"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiPost, apiPut, http } from "@/lib/api";
import type { ApiError } from "@/lib/errors";
import { keys, type Result } from "@/lib/query";
import type { Acknowledged, Project, Site, Uuid } from "@/types";

export function useTransition(projectUuid: Uuid) {
  const qc = useQueryClient();
  return useMutation<
    { from: string; to: string; occurred_at: string },
    ApiError,
    { to: string; reason?: string }
  >({
    mutationFn: (body) => apiPost(`/projects/${projectUuid}/transition`, body),
    onSuccess: () => {
      // A transition can publish a notice, change the queue a project sits in,
      // and alter what the dashboard shows. Invalidate broadly.
      void qc.invalidateQueries({ queryKey: ["project", projectUuid] });
      void qc.invalidateQueries({ queryKey: ["projects"] });
      void qc.invalidateQueries({ queryKey: keys.dashboard.all });
    },
  });
}

export interface ProjectInput {
  project_name: string;
  description: string;
  dco_user_uuid: string;
  internal_project_name?: string | null;
  requesting_team?: string | null;
}

export function useCreateProject(): Result<Project, ProjectInput> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body) => apiPost<Project>("/projects", body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["projects"] });
      void qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}

export function useUpdateProject(uuid: Uuid): Result<Project, Partial<ProjectInput>> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body) => apiPut<Project>(`/projects/${uuid}`, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["project", uuid] });
      void qc.invalidateQueries({ queryKey: ["projects"] });
    },
  });
}

export function useAssignDco(uuid: Uuid): Result<Acknowledged, { dco_user_uuid: string }> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body) => apiPost<Acknowledged>(`/projects/${uuid}/dco`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["project", uuid] }),
  });
}

export function useCloseProject(uuid: Uuid): Result<Acknowledged, { reason?: string }> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body) => apiPost<Acknowledged>(`/projects/${uuid}/close`, body),
    onSuccess: () => {
      // Closing revokes every live link, so the link views are stale too.
      void qc.invalidateQueries({ queryKey: ["project", uuid] });
      void qc.invalidateQueries({ queryKey: ["projects"] });
      void qc.invalidateQueries({ queryKey: ["all", "links"] });
    },
  });
}

export interface SiteInput {
  site_label: string;
  location?: string | null;
  processor_uuid?: string | null;
  /** The data source that will report from this site. Must belong to the same
   *  processor — the API refuses the pair otherwise. */
  source_uuid?: string | null;
}

export function useCreateSite(projectUuid: Uuid): Result<Site, SiteInput> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body) => apiPost<Site>(`/projects/${projectUuid}/sites`, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["project", projectUuid] });
      void qc.invalidateQueries({ queryKey: ["all", "sites"] });
    },
  });
}

export function useUpdateSite(uuid: Uuid): Result<Site, Partial<SiteInput>> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body) => apiPut<Site>(`/sites/${uuid}`, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["all", "sites"] });
      void qc.invalidateQueries({ queryKey: ["project"] });
    },
  });
}

export function useDeactivateSite(): Result<Acknowledged, Uuid> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (uuid) => apiPost<Acknowledged>(`/sites/${uuid}/deactivate`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["all", "sites"] });
      void qc.invalidateQueries({ queryKey: ["all", "links"] });
      void qc.invalidateQueries({ queryKey: ["project"] });
    },
  });
}

export interface AgentInput {
  expires_at: string;
  max_uses?: number | null;
  agent_ref?: string | null;
}

export interface MintedLink {
  link_uuid: Uuid;
  /** Returned once and never again - the database stores only its keyed digest. */
  token: string;
  url_path: string;
  expires_at: string;
  max_uses: number | null;
  warning: string;
}

export function useAssignAgent(siteUuid: Uuid): Result<MintedLink, AgentInput> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body) => apiPost<MintedLink>(`/sites/${siteUuid}/agent`, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["all", "links"] });
      void qc.invalidateQueries({ queryKey: ["all", "sites"] });
      void qc.invalidateQueries({ queryKey: ["project"] });
    },
  });
}

export interface ApprovalUpload {
  approval_type: string;
  reference_no: string;
  approved_on: string;
  proof: File;
}

export function useUploadApproval(projectUuid: Uuid): Result<unknown, ApprovalUpload> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input) => {
      const body = new FormData();
      body.append("approval_type", input.approval_type);
      body.append("reference_no", input.reference_no);
      body.append("approved_on", input.approved_on);
      body.append("proof", input.proof);
      // Content-Type is deliberately unset: the browser must add the multipart
      // boundary itself, and the client strips the JSON default for FormData.
      const { data } = await http.post(`/projects/${projectUuid}/approvals`, body);
      return data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["project", projectUuid] });
      void qc.invalidateQueries({ queryKey: ["all", "approvals"] });
      // An approval with proof unblocks under_process -> pending_approval, so
      // the transition view is stale the moment this succeeds.
      void qc.invalidateQueries({ queryKey: ["project", projectUuid, "transitions"] });
    },
  });
}
