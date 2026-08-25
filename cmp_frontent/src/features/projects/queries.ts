/**
 * Reading projects, their sites, approvals and lifecycle state.
 */
"use client";

import { useQuery } from "@tanstack/react-query";
import { apiGet, queryString } from "@/lib/api";
import type { ApiError } from "@/lib/errors";
import { keys, type ListFilters } from "@/lib/query";
import type {
  Approval,
  ApprovalListRow,
  Page,
  Project,
  ProjectSummary,
  Site,
  SiteListRow,
  StatusHistoryEntry,
  TransitionsView,
  Uuid,
} from "@/types";

export interface ProjectFilters extends Record<string, unknown> {
  status?: string;
  q?: string;
  limit?: number;
  cursor?: string;
  sort?: string;
}

export function useProjects(filters: ProjectFilters = {}) {
  return useQuery<Page<Project>, ApiError>({
    queryKey: keys.project.list(filters),
    queryFn: () => apiGet<Page<Project>>(`/projects${queryString(filters)}`),
  });
}

export function useProject(uuid: Uuid | undefined) {
  return useQuery<Project, ApiError>({
    queryKey: keys.project.detail(uuid ?? ""),
    queryFn: () => apiGet<Project>(`/projects/${uuid}`),
    enabled: Boolean(uuid),
  });
}

export function useProjectSummary(uuid: Uuid | undefined) {
  return useQuery<ProjectSummary, ApiError>({
    queryKey: keys.project.summary(uuid ?? ""),
    queryFn: () => apiGet<ProjectSummary>(`/projects/${uuid}/summary`),
    enabled: Boolean(uuid),
  });
}

export function useProjectHistory(uuid: Uuid | undefined) {
  return useQuery<StatusHistoryEntry[], ApiError>({
    queryKey: keys.project.history(uuid ?? ""),
    queryFn: () => apiGet<StatusHistoryEntry[]>(`/projects/${uuid}/history`),
    enabled: Boolean(uuid),
  });
}

/**
 * What this user may do next.
 *
 * The reason the frontend has no copy of the state machine: this endpoint says
 * which transitions exist, whether each is currently allowed, and what is
 * blocking the ones that are not.
 */
export function useTransitions(uuid: Uuid | undefined) {
  return useQuery<TransitionsView, ApiError>({
    queryKey: keys.project.transitions(uuid ?? ""),
    queryFn: () => apiGet<TransitionsView>(`/projects/${uuid}/transitions`),
    enabled: Boolean(uuid),
    // Preconditions change as approvals are uploaded; do not serve a cached
    // "blocked" state to somebody who just fixed the blocker.
    staleTime: 0,
  });
}

export function useApprovals(uuid: Uuid | undefined) {
  return useQuery<Approval[], ApiError>({
    queryKey: keys.project.approvals(uuid ?? ""),
    queryFn: () => apiGet<Approval[]>(`/projects/${uuid}/approvals`),
    enabled: Boolean(uuid),
  });
}

export function useSites(uuid: Uuid | undefined) {
  return useQuery<Site[], ApiError>({
    queryKey: keys.project.sites(uuid ?? ""),
    queryFn: () => apiGet<Site[]>(`/projects/${uuid}/sites`),
    enabled: Boolean(uuid),
  });
}

export function useAllSites(filters: ListFilters = {}) {
  return useQuery<Page<SiteListRow>, ApiError>({
    queryKey: keys.project.allSites(filters),
    queryFn: () => apiGet<Page<SiteListRow>>(`/sites${queryString(filters)}`),
  });
}

export function useAllApprovals(filters: ListFilters = {}) {
  return useQuery<Page<ApprovalListRow>, ApiError>({
    queryKey: keys.project.allApprovals(filters),
    queryFn: () => apiGet<Page<ApprovalListRow>>(`/approvals${queryString(filters)}`),
  });
}

/**
 * Active DCOs, for nomination.
 *
 * Not `useUsers({role: "dco"})`: an R&D User must nominate a DCO to register a
 * project, but the permission matrix denies them the account register entirely.
 * This is the narrow lookup that makes the requirement satisfiable without
 * opening the register.
 */
export function useAssignableDcos() {
  return useQuery<Array<{ uuid: Uuid; full_name: string; email: string }>, ApiError>({
    queryKey: ["users", "assignable-dcos"],
    queryFn: () => apiGet("/users/assignable-dcos"),
    staleTime: 5 * 60_000,
  });
}
