/**
 * Reading projects, their sites, approvals and lifecycle state.
 *
 * Each hook does one thing: name a cache key and say when the request may run.
 * The request itself is in `api.ts`. That division is what keeps these readable
 * — a hook here is three lines, and the three lines are the caching decision.
 */
"use client";

import { useQuery } from "@tanstack/react-query";

import {
  getProject,
  getProjectHistory,
  getProjectSummary,
  getTransitions,
  listApprovals,
  listAssignableDcos,
  listProjectApprovals,
  listProjectSites,
  listProjects,
  listSites,
  type Nominee,
  type ProjectFilters,
} from "@/features/projects/api";
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

export type { Nominee, ProjectFilters };

export function useProjects(filters: ProjectFilters = {}) {
  return useQuery<Page<Project>, ApiError>({
    queryKey: keys.project.list(filters),
    queryFn: () => listProjects(filters),
  });
}

/**
 * `enabled` guards every hook that takes a uuid.
 *
 * A router param is undefined on the first render. Without the guard the
 * console asks for `/projects/undefined`, which is a 404 in the server log and
 * a flash of an error state for the user.
 */
export function useProject(uuid: Uuid | undefined) {
  return useQuery<Project, ApiError>({
    queryKey: keys.project.detail(uuid ?? ""),
    queryFn: () => getProject(uuid!),
    enabled: Boolean(uuid),
  });
}

export function useProjectSummary(uuid: Uuid | undefined) {
  return useQuery<ProjectSummary, ApiError>({
    queryKey: keys.project.summary(uuid ?? ""),
    queryFn: () => getProjectSummary(uuid!),
    enabled: Boolean(uuid),
  });
}

export function useProjectHistory(uuid: Uuid | undefined) {
  return useQuery<StatusHistoryEntry[], ApiError>({
    queryKey: keys.project.history(uuid ?? ""),
    queryFn: () => getProjectHistory(uuid!),
    enabled: Boolean(uuid),
  });
}

/**
 * What this user may do next, and why anything else is blocked.
 *
 * Never cached across a mutation: a transition changes the answer, which is why
 * every write in `mutations.ts` invalidates the project prefix.
 */
export function useTransitions(uuid: Uuid | undefined) {
  return useQuery<TransitionsView, ApiError>({
    queryKey: keys.project.transitions(uuid ?? ""),
    queryFn: () => getTransitions(uuid!),
    enabled: Boolean(uuid),
  });
}

export function useApprovals(uuid: Uuid | undefined) {
  return useQuery<Approval[], ApiError>({
    queryKey: keys.project.approvals(uuid ?? ""),
    queryFn: () => listProjectApprovals(uuid!),
    enabled: Boolean(uuid),
  });
}

export function useSites(uuid: Uuid | undefined) {
  return useQuery<Site[], ApiError>({
    queryKey: keys.project.sites(uuid ?? ""),
    queryFn: () => listProjectSites(uuid!),
    enabled: Boolean(uuid),
  });
}

export function useAllSites(filters: ListFilters = {}) {
  return useQuery<Page<SiteListRow>, ApiError>({
    queryKey: keys.project.allSites(filters),
    queryFn: () => listSites(filters),
  });
}

export function useAllApprovals(filters: ListFilters = {}) {
  return useQuery<Page<ApprovalListRow>, ApiError>({
    queryKey: keys.project.allApprovals(filters),
    queryFn: () => listApprovals(filters),
  });
}

export function useAssignableDcos() {
  return useQuery<Nominee[], ApiError>({
    queryKey: keys.users.assignableDcos,
    queryFn: listAssignableDcos,
  });
}
