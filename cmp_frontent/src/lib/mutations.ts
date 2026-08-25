/**
 * Every write the console can perform.
 *
 * One hook per endpoint, each responsible for invalidating exactly what its
 * write changed. That is the part worth getting right: a create that does not
 * invalidate its list leaves the user staring at a screen that does not show the
 * thing they just made, and the usual "fix" is a page reload that hides the bug.
 *
 * No mutation retries. These write to append-only tables - a retried export
 * would produce a second set of `export_line` rows and corrupt the disclosure
 * record - and the shared query client already sets `retry: false` for
 * mutations. It is restated here because it is load-bearing, not incidental.
 */
"use client";

import { useMutation, useQueryClient, type UseMutationResult } from "@tanstack/react-query";

import { apiPatch, apiPost, apiPut, http } from "@/lib/api-client";
import type { ApiError } from "@/lib/api-error";
import type {
  Acknowledged,
  ImportValidation,
  LanguageCode,
  Notice,
  Processor,
  Project,
  Purpose,
  Site,
  User,
  Uuid,
} from "@/lib/types";

type Result<TData, TVars> = UseMutationResult<TData, ApiError, TVars>;

/* ==================================================================== projects */

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

/* ====================================================================== sites */

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

/* =================================================================== purposes */

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

/* ================================================================= processors */

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

/* ==================================================================== sources */

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

/* ==================================================================== notices */

export interface NoticeInput {
  withdraw_url: string;
  exercise_rights_url: string;
  board_complaint_url: string;
  dpo_contact: string;
  /** Omit and the server mints one from the project name and the year. A DPO
   *  cannot see the other projects' codes, so asking them to invent a unique one
   *  is asking them to guess. */
  notice_code?: string | null;
  change_class?: string | null;
  /** The text a data subject actually reads, saved with the notice in one step. */
  rendered_text?: string | null;
  language_code?: string | null;
}

export function useCreateNotice(projectUuid: Uuid): Result<Notice, NoticeInput> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body) => apiPost<Notice>(`/projects/${projectUuid}/notices`, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["project", projectUuid] });
      void qc.invalidateQueries({ queryKey: ["all", "notices"] });
    },
  });
}

/**
 * Start a project's notice from one that already exists.
 *
 * The server copies rather than shares: a notice belongs to exactly one project,
 * because every consent artefact records which notice was served and a shared
 * row would make "which text, for which project" unanswerable.
 */
export function useCopyNotice(projectUuid: Uuid): Result<Notice, { source_notice_uuid: Uuid }> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body) => apiPost<Notice>(`/projects/${projectUuid}/notices/copy`, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["project", projectUuid] });
      void qc.invalidateQueries({ queryKey: ["all", "notices"] });
    },
  });
}

export function useUpdateNotice(uuid: Uuid): Result<Notice, Partial<NoticeInput>> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body) => apiPut<Notice>(`/notices/${uuid}`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notice", uuid] }),
  });
}

export function useAttachPurpose(
  noticeUuid: Uuid,
): Result<unknown, { purpose_uuid: string; display_order?: number; is_mandatory?: boolean }> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body) => apiPost(`/notices/${noticeUuid}/purposes`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notice", noticeUuid] }),
  });
}

export function useDetachPurpose(noticeUuid: Uuid): Result<void, Uuid> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (purposeUuid) => {
      await http.delete(`/notices/${noticeUuid}/purposes/${purposeUuid}`);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notice", noticeUuid] }),
  });
}

export function useSetLanguage(
  noticeUuid: Uuid,
): Result<unknown, { language_code: LanguageCode; rendered_text: string }> {
  const qc = useQueryClient();
  return useMutation({
    // The code is a query parameter on create and a path segment on update; the
    // create form is the one the console uses, and it upserts server-side.
    mutationFn: ({ language_code, rendered_text }) =>
      apiPost(`/notices/${noticeUuid}/languages?language_code=${language_code}`, {
        rendered_text,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notice", noticeUuid] }),
  });
}

export function useApproveLanguage(noticeUuid: Uuid): Result<Acknowledged, LanguageCode> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (code) =>
      apiPost<Acknowledged>(`/notices/${noticeUuid}/languages/${code}/approve`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notice", noticeUuid] }),
  });
}

/* ====================================================================== users */

export interface UserInput {
  full_name: string;
  email: string;
  role: string;
  username?: string | null;
  mobile?: string | null;
  organization_id?: string | null;
  person_type?: string | null;
}

export function useCreateUser(): Result<User, UserInput> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body) => apiPost<User>("/users", body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["users"] }),
  });
}

export function useUpdateUser(uuid: Uuid): Result<User, Partial<UserInput>> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body) => apiPatch<User>(`/users/${uuid}`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["users"] }),
  });
}

export function useChangeRole(
  uuid: Uuid,
): Result<Acknowledged, { role: string; reason?: string }> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body) => apiPost<Acknowledged>(`/users/${uuid}/role`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["users"] }),
  });
}

export function useResetMfa(): Result<Acknowledged, Uuid> {
  return useMutation({
    mutationFn: (uuid) => apiPost<Acknowledged>(`/users/${uuid}/mfa/reset`),
  });
}

export function useForceLogout(): Result<Acknowledged, Uuid> {
  return useMutation({
    mutationFn: async (uuid) => {
      const { data } = await http.delete<Acknowledged>(`/users/${uuid}/sessions`);
      return data;
    },
  });
}

/* ==================================================================== exports */

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

/* ============================================== uploads (multipart/form-data) */

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
      void qc.invalidateQueries({ queryKey: ["imports"] });
      void qc.invalidateQueries({ queryKey: ["all", "collections"] });
    },
  });
}

/* ======================================================================= /me */

export function useUpdateMe(): Result<unknown, { full_name?: string; mobile?: string }> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body) => apiPatch("/me", body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["auth", "me"] }),
  });
}

export function useSetPersonType(): Result<
  Acknowledged,
  { person_type: string; reason?: string }
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body) => apiPost<Acknowledged>("/me/person-type", body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["auth", "me"] }),
  });
}
