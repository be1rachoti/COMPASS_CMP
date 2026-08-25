/**
 * Typed hooks over the API.
 *
 * One hook per endpoint the UI uses, with the query key defined alongside it in
 * `keys`. Keeping keys in one object is what makes invalidation reliable: after
 * a transition, `invalidate(keys.project(uuid))` refreshes every view of that
 * project, and nobody has to remember which components were showing it.
 */
"use client";

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationOptions,
  type UseQueryOptions,
} from "@tanstack/react-query";

import { apiGet, apiPost, apiPut, queryString } from "@/lib/api-client";
import type { ApiError } from "@/lib/api-error";
import type {
  Approval,
  ApprovalListRow,
  AuditEntry,
  AuditVerification,
  Collection,
  CollectionAsset,
  CollectionDetail,
  CollectionExceptions,
  CollectionListRow,
  ConsentArtefact,
  ConsentAsset,
  ConsentLink,
  ConsentListRow,
  ConsentRow,
  DashboardData,
  DataCategory,
  DataSource,
  EnumMap,
  ExportListRow,
  ExportRecord,
  ImportBatch,
  ImportBatchDetail,
  ImportErrorReport,
  LinkListRow,
  LinkStats,
  MyConsent,
  Notice,
  NoticeChecklist,
  NoticeLanguage,
  NoticeListRow,
  Page,
  Processor,
  Project,
  ProjectSummary,
  Purpose,
  PurposeGrant,
  PurposeUsageEntry,
  SessionInfo,
  Site,
  SiteListRow,
  StatusHistoryEntry,
  TransitionsView,
  User,
  Uuid,
  WithdrawalResult,
} from "@/lib/types";

/* -------------------------------------------------------------------- keys */
export const keys = {
  me: ["auth", "me"] as const,
  meta: {
    enums: ["meta", "enums"] as const,
    dataCategories: ["meta", "data-categories"] as const,
  },
  dashboard: ["dashboard"] as const,
  notifications: ["notifications"] as const,

  projects: (params?: Record<string, unknown>) => ["projects", params ?? {}] as const,
  project: (uuid: Uuid) => ["project", uuid] as const,
  projectSummary: (uuid: Uuid) => ["project", uuid, "summary"] as const,
  projectHistory: (uuid: Uuid) => ["project", uuid, "history"] as const,
  transitions: (uuid: Uuid) => ["project", uuid, "transitions"] as const,
  approvals: (uuid: Uuid) => ["project", uuid, "approvals"] as const,
  sites: (uuid: Uuid) => ["project", uuid, "sites"] as const,
  notices: (uuid: Uuid) => ["project", uuid, "notices"] as const,
  links: (uuid: Uuid) => ["project", uuid, "links"] as const,
  consents: (uuid: Uuid, params?: Record<string, unknown>) =>
    ["project", uuid, "consents", params ?? {}] as const,
  consentSummary: (uuid: Uuid) => ["project", uuid, "consents", "summary"] as const,
  exports: (uuid: Uuid) => ["project", uuid, "exports"] as const,
  collections: (uuid: Uuid) => ["project", uuid, "collections"] as const,

  notice: (uuid: Uuid) => ["notice", uuid] as const,
  noticeChecklist: (uuid: Uuid) => ["notice", uuid, "checklist"] as const,
  noticePurposes: (uuid: Uuid) => ["notice", uuid, "purposes"] as const,
  noticeLanguages: (uuid: Uuid) => ["notice", uuid, "languages"] as const,

  purposes: (params?: Record<string, unknown>) => ["purposes", params ?? {}] as const,
  purpose: (uuid: Uuid) => ["purpose", uuid] as const,
  purposeUsage: (uuid: Uuid) => ["purpose", uuid, "usage"] as const,
  processors: (params?: Record<string, unknown>) => ["processors", params ?? {}] as const,
  sources: (params?: Record<string, unknown>) => ["sources", params ?? {}] as const,

  linkStats: (uuid: Uuid) => ["link", uuid, "stats"] as const,
  users: (params?: Record<string, unknown>) => ["users", params ?? {}] as const,
  audit: (params?: Record<string, unknown>) => ["audit", params ?? {}] as const,
  auditVerify: ["audit", "verify"] as const,

  imports: (params?: Record<string, unknown>) => ["imports", params ?? {}] as const,

  // Cross-project lists behind the console's nav sections.
  allNotices: (params?: Record<string, unknown>) => ["all", "notices", params ?? {}] as const,
  allLinks: (params?: Record<string, unknown>) => ["all", "links", params ?? {}] as const,
  allConsents: (params?: Record<string, unknown>) => ["all", "consents", params ?? {}] as const,
  allExports: (params?: Record<string, unknown>) => ["all", "exports", params ?? {}] as const,
  allCollections: (params?: Record<string, unknown>) =>
    ["all", "collections", params ?? {}] as const,
  allSites: (params?: Record<string, unknown>) => ["all", "sites", params ?? {}] as const,
  allApprovals: (params?: Record<string, unknown>) =>
    ["all", "approvals", params ?? {}] as const,
  collectionExceptions: (uuid: Uuid) => ["collection", uuid, "exceptions"] as const,
  collection: (uuid: Uuid) => ["collection", uuid] as const,
  collectionAssets: (uuid: Uuid) => ["collection", uuid, "assets"] as const,
  importBatch: (uuid: Uuid) => ["import", uuid] as const,
  importErrors: (uuid: Uuid) => ["import", uuid, "errors"] as const,
  purposeVersions: (uuid: Uuid) => ["purpose", uuid, "versions"] as const,

  consent: (uuid: Uuid) => ["consent", uuid] as const,
  consentGrants: (uuid: Uuid) => ["consent", uuid, "grants"] as const,
  consentAssets: (uuid: Uuid) => ["consent", uuid, "assets"] as const,

  myConsents: ["me", "consents"] as const,
  myConsent: (uuid: Uuid) => ["me", "consent", uuid] as const,
  myConsentGrants: (uuid: Uuid) => ["me", "consent", uuid, "grants"] as const,
  myConsentHistory: (uuid: Uuid) => ["me", "consent", uuid, "history"] as const,
  myConsentNotice: (uuid: Uuid) => ["me", "consent", uuid, "notice"] as const,
  myDisclosures: ["me", "disclosures"] as const,
};

type Options<T> = Omit<UseQueryOptions<T, ApiError>, "queryKey" | "queryFn">;

/* ------------------------------------------------------------------- meta */
export function useEnums(options?: Options<EnumMap>) {
  return useQuery<EnumMap, ApiError>({
    queryKey: keys.meta.enums,
    queryFn: () => apiGet<EnumMap>("/meta/enums"),
    // Reference data. It changes when the backend deploys, not while somebody
    // is filling in a form.
    staleTime: 60 * 60_000,
    ...options,
  });
}

export function useDataCategories() {
  return useQuery<{ items: DataCategory[] }, ApiError>({
    queryKey: keys.meta.dataCategories,
    queryFn: () => apiGet<{ items: DataCategory[] }>("/meta/data-categories"),
    staleTime: 60 * 60_000,
  });
}

/* -------------------------------------------------------------- dashboard */
export function useDashboard() {
  return useQuery<DashboardData, ApiError>({
    queryKey: keys.dashboard,
    queryFn: () => apiGet<DashboardData>("/dashboard"),
  });
}

/* --------------------------------------------------------------- projects */
export interface ProjectFilters extends Record<string, unknown> {
  status?: string;
  q?: string;
  limit?: number;
  cursor?: string;
  sort?: string;
}

export function useProjects(filters: ProjectFilters = {}) {
  return useQuery<Page<Project>, ApiError>({
    queryKey: keys.projects(filters),
    queryFn: () => apiGet<Page<Project>>(`/projects${queryString(filters)}`),
  });
}

export function useProject(uuid: Uuid | undefined) {
  return useQuery<Project, ApiError>({
    queryKey: keys.project(uuid ?? ""),
    queryFn: () => apiGet<Project>(`/projects/${uuid}`),
    enabled: Boolean(uuid),
  });
}

export function useProjectSummary(uuid: Uuid | undefined) {
  return useQuery<ProjectSummary, ApiError>({
    queryKey: keys.projectSummary(uuid ?? ""),
    queryFn: () => apiGet<ProjectSummary>(`/projects/${uuid}/summary`),
    enabled: Boolean(uuid),
  });
}

export function useProjectHistory(uuid: Uuid | undefined) {
  return useQuery<StatusHistoryEntry[], ApiError>({
    queryKey: keys.projectHistory(uuid ?? ""),
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
    queryKey: keys.transitions(uuid ?? ""),
    queryFn: () => apiGet<TransitionsView>(`/projects/${uuid}/transitions`),
    enabled: Boolean(uuid),
    // Preconditions change as approvals are uploaded; do not serve a cached
    // "blocked" state to somebody who just fixed the blocker.
    staleTime: 0,
  });
}

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
      void qc.invalidateQueries({ queryKey: keys.dashboard });
    },
  });
}

export function useApprovals(uuid: Uuid | undefined) {
  return useQuery<Approval[], ApiError>({
    queryKey: keys.approvals(uuid ?? ""),
    queryFn: () => apiGet<Approval[]>(`/projects/${uuid}/approvals`),
    enabled: Boolean(uuid),
  });
}

export function useSites(uuid: Uuid | undefined) {
  return useQuery<Site[], ApiError>({
    queryKey: keys.sites(uuid ?? ""),
    queryFn: () => apiGet<Site[]>(`/projects/${uuid}/sites`),
    enabled: Boolean(uuid),
  });
}

/* ---------------------------------------------------------------- notices */
export function useNotices(projectUuid: Uuid | undefined) {
  return useQuery<Notice[], ApiError>({
    queryKey: keys.notices(projectUuid ?? ""),
    queryFn: () => apiGet<Notice[]>(`/projects/${projectUuid}/notices`),
    enabled: Boolean(projectUuid),
  });
}

export function useNotice(uuid: Uuid | undefined) {
  return useQuery<Notice, ApiError>({
    queryKey: keys.notice(uuid ?? ""),
    queryFn: () => apiGet<Notice>(`/notices/${uuid}`),
    enabled: Boolean(uuid),
  });
}

export function useNoticeChecklist(uuid: Uuid | undefined) {
  return useQuery<NoticeChecklist, ApiError>({
    queryKey: keys.noticeChecklist(uuid ?? ""),
    queryFn: () => apiGet<NoticeChecklist>(`/notices/${uuid}/checklist`),
    enabled: Boolean(uuid),
    staleTime: 0,
  });
}

export function useNoticePurposes(uuid: Uuid | undefined) {
  return useQuery<Purpose[], ApiError>({
    queryKey: keys.noticePurposes(uuid ?? ""),
    queryFn: () => apiGet<Purpose[]>(`/notices/${uuid}/purposes`),
    enabled: Boolean(uuid),
  });
}

export function useNoticeLanguages(uuid: Uuid | undefined) {
  return useQuery<NoticeLanguage[], ApiError>({
    queryKey: keys.noticeLanguages(uuid ?? ""),
    queryFn: () => apiGet<NoticeLanguage[]>(`/notices/${uuid}/languages`),
    enabled: Boolean(uuid),
  });
}

export function usePublishNotice(noticeUuid: Uuid) {
  const qc = useQueryClient();
  return useMutation<Notice, ApiError, void>({
    mutationFn: () => apiPost<Notice>(`/notices/${noticeUuid}/publish`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["notice", noticeUuid] });
      void qc.invalidateQueries({ queryKey: ["project"] });
    },
  });
}

/* --------------------------------------------------------------- registry */
export function usePurposes(filters: Record<string, unknown> = {}) {
  return useQuery<Page<Purpose>, ApiError>({
    queryKey: keys.purposes(filters),
    queryFn: () => apiGet<Page<Purpose>>(`/purposes${queryString(filters)}`),
  });
}

export function usePurpose(uuid: Uuid | undefined) {
  return useQuery<Purpose, ApiError>({
    queryKey: keys.purpose(uuid ?? ""),
    queryFn: () => apiGet<Purpose>(`/purposes/${uuid}`),
    enabled: Boolean(uuid),
  });
}

/** Which notices reference a purpose - how the UI knows retirement is blocked
 *  before the user tries it. */
export function usePurposeUsage(uuid: Uuid | undefined) {
  return useQuery<{ items: PurposeUsageEntry[]; retirable: boolean; total: number }, ApiError>({
    queryKey: keys.purposeUsage(uuid ?? ""),
    queryFn: () => apiGet(`/purposes/${uuid}/usage`),
    enabled: Boolean(uuid),
  });
}

export function useProcessors(filters: Record<string, unknown> = {}) {
  return useQuery<Page<Processor>, ApiError>({
    queryKey: keys.processors(filters),
    queryFn: () => apiGet<Page<Processor>>(`/processors${queryString(filters)}`),
  });
}

export function useSources(filters: Record<string, unknown> = {}) {
  return useQuery<Page<DataSource>, ApiError>({
    queryKey: keys.sources(filters),
    queryFn: () => apiGet<Page<DataSource>>(`/sources${queryString(filters)}`),
  });
}

/* ---------------------------------------------------------------- consent */
export function useConsents(projectUuid: Uuid | undefined, filters: Record<string, unknown> = {}) {
  return useQuery<Page<ConsentRow>, ApiError>({
    queryKey: keys.consents(projectUuid ?? "", filters),
    queryFn: () =>
      apiGet<Page<ConsentRow>>(`/projects/${projectUuid}/consents${queryString(filters)}`),
    enabled: Boolean(projectUuid),
  });
}

export function useConsentSummary(projectUuid: Uuid | undefined) {
  return useQuery<Record<string, number>, ApiError>({
    queryKey: keys.consentSummary(projectUuid ?? ""),
    queryFn: () => apiGet(`/projects/${projectUuid}/consents/summary`),
    enabled: Boolean(projectUuid),
  });
}

export function useLinks(projectUuid: Uuid | undefined) {
  return useQuery<ConsentLink[], ApiError>({
    queryKey: keys.links(projectUuid ?? ""),
    queryFn: () => apiGet<ConsentLink[]>(`/projects/${projectUuid}/links`),
    enabled: Boolean(projectUuid),
  });
}

export function useLinkStats(uuid: Uuid | undefined) {
  return useQuery<LinkStats, ApiError>({
    queryKey: keys.linkStats(uuid ?? ""),
    queryFn: () => apiGet<LinkStats>(`/links/${uuid}/stats`),
    enabled: Boolean(uuid),
  });
}

/* --------------------------------------------------------------- exchange */
export function useExports(projectUuid: Uuid | undefined) {
  return useQuery<ExportRecord[], ApiError>({
    queryKey: keys.exports(projectUuid ?? ""),
    queryFn: () => apiGet<ExportRecord[]>(`/projects/${projectUuid}/exports`),
    enabled: Boolean(projectUuid),
  });
}

export function useGenerateExport(projectUuid: Uuid) {
  const qc = useQueryClient();
  return useMutation<ExportRecord, ApiError, { type: string; site: Uuid }>({
    mutationFn: (body) => apiPost<ExportRecord>(`/projects/${projectUuid}/exports`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.exports(projectUuid) }),
  });
}

export function useImports(filters: Record<string, unknown> = {}) {
  return useQuery<Page<ImportBatch>, ApiError>({
    queryKey: keys.imports(filters),
    queryFn: () => apiGet<Page<ImportBatch>>(`/imports${queryString(filters)}`),
  });
}

export function useCollections(projectUuid: Uuid | undefined) {
  return useQuery<Page<Collection>, ApiError>({
    queryKey: keys.collections(projectUuid ?? ""),
    queryFn: () => apiGet<Page<Collection>>(`/projects/${projectUuid}/collections`),
    enabled: Boolean(projectUuid),
  });
}

export function useCollectionExceptions(uuid: Uuid | undefined) {
  return useQuery<CollectionExceptions, ApiError>({
    queryKey: keys.collectionExceptions(uuid ?? ""),
    queryFn: () => apiGet<CollectionExceptions>(`/collections/${uuid}/exceptions`),
    enabled: Boolean(uuid),
  });
}

export function useCollection(uuid: Uuid | undefined) {
  return useQuery<CollectionDetail, ApiError>({
    queryKey: keys.collection(uuid ?? ""),
    queryFn: () => apiGet<CollectionDetail>(`/collections/${uuid}`),
    enabled: Boolean(uuid),
  });
}

export function useCollectionAssets(uuid: Uuid | undefined) {
  return useQuery<CollectionAsset[], ApiError>({
    queryKey: keys.collectionAssets(uuid ?? ""),
    queryFn: () => apiGet<CollectionAsset[]>(`/collections/${uuid}/assets`),
    enabled: Boolean(uuid),
  });
}

export function useImportBatch(uuid: Uuid | undefined) {
  return useQuery<ImportBatchDetail, ApiError>({
    queryKey: keys.importBatch(uuid ?? ""),
    queryFn: () => apiGet<ImportBatchDetail>(`/imports/${uuid}`),
    enabled: Boolean(uuid),
  });
}

export function useImportErrors(uuid: Uuid | undefined) {
  return useQuery<ImportErrorReport, ApiError>({
    queryKey: keys.importErrors(uuid ?? ""),
    queryFn: () => apiGet<ImportErrorReport>(`/imports/${uuid}/errors`),
    enabled: Boolean(uuid),
  });
}

export function usePurposeVersions(uuid: Uuid | undefined) {
  return useQuery<Purpose[], ApiError>({
    queryKey: keys.purposeVersions(uuid ?? ""),
    queryFn: () => apiGet<Purpose[]>(`/purposes/${uuid}/versions`),
    enabled: Boolean(uuid),
    // DPO and admin only. A 403 is the answer, not a hiccup worth retrying.
    retry: false,
  });
}

/* ------------------------------------------------------------------ audit */
export function useAudit(filters: Record<string, unknown> = {}) {
  return useQuery<Page<AuditEntry>, ApiError>({
    queryKey: keys.audit(filters),
    queryFn: () => apiGet<Page<AuditEntry>>(`/audit${queryString(filters)}`),
  });
}

export function useAuditVerify(enabled = false) {
  return useQuery<AuditVerification, ApiError>({
    queryKey: keys.auditVerify,
    queryFn: () => apiGet<AuditVerification>("/audit/verify"),
    // Walking the whole chain is not free. Run it on request, not on page load.
    enabled,
    staleTime: 0,
    gcTime: 0,
  });
}

/* ------------------------------------------------------------------ users */
export function useUsers(filters: Record<string, unknown> = {}) {
  return useQuery<Page<User>, ApiError>({
    queryKey: keys.users(filters),
    queryFn: () => apiGet<Page<User>>(`/users${queryString(filters)}`),
  });
}

/* --------------------------------------------------------- data subject */
export function useMyConsents() {
  return useQuery<MyConsent[], ApiError>({
    queryKey: keys.myConsents,
    queryFn: () => apiGet<MyConsent[]>("/me/consents"),
  });
}

export function useMyConsentGrants(uuid: Uuid | undefined) {
  return useQuery<PurposeGrant[], ApiError>({
    queryKey: keys.myConsentGrants(uuid ?? ""),
    queryFn: () => apiGet<PurposeGrant[]>(`/me/consents/${uuid}/grants`),
    enabled: Boolean(uuid),
  });
}

export function useMyConsentHistory(uuid: Uuid | undefined) {
  return useQuery({
    queryKey: keys.myConsentHistory(uuid ?? ""),
    queryFn: () => apiGet(`/me/consents/${uuid}/history`),
    enabled: Boolean(uuid),
  });
}

/** The exact text she was shown, matched on the hash copied at capture. */
export function useMyConsentNotice(uuid: Uuid | undefined) {
  return useQuery({
    queryKey: keys.myConsentNotice(uuid ?? ""),
    queryFn: () => apiGet(`/me/consents/${uuid}/notice`),
    enabled: Boolean(uuid),
  });
}

export function useMyDisclosures() {
  return useQuery({
    queryKey: keys.myDisclosures,
    queryFn: () => apiGet("/me/disclosures"),
  });
}

export function useWithdraw(consentUuid: Uuid) {
  const qc = useQueryClient();
  return useMutation<WithdrawalResult, ApiError, { purposes?: Uuid[]; all?: boolean }>({
    mutationFn: (body) => apiPost<WithdrawalResult>(`/me/consents/${consentUuid}/withdraw`, body),
    onSuccess: () => {
      // Withdrawal creates a *new* artefact that supersedes this one, so the
      // whole /me tree is stale, not just this record.
      void qc.invalidateQueries({ queryKey: ["me"] });
    },
  });
}

/* ------------------------------------------------------------- generic */
export function useApiMutation<TData, TVariables>(
  path: string | ((vars: TVariables) => string),
  method: "post" | "put" = "post",
  options?: UseMutationOptions<TData, ApiError, TVariables>,
) {
  return useMutation<TData, ApiError, TVariables>({
    mutationFn: (vars) => {
      const url = typeof path === "function" ? path(vars) : path;
      return method === "put" ? apiPut<TData>(url, vars) : apiPost<TData>(url, vars);
    },
    ...options,
  });
}


/* ============================================ cross-project console listings
 * The per-project endpoints answer "what does this project have". These answer
 * "what is outstanding anywhere", which is what each nav section asks and what
 * cannot be assembled client-side without one request per project.
 */
export interface ListFilters extends Record<string, unknown> {
  status?: string;
  project?: string;
  type?: string;
  q?: string;
  limit?: number;
  cursor?: string;
  sort?: string;
}

export function useAllNotices(filters: ListFilters = {}) {
  return useQuery<Page<NoticeListRow>, ApiError>({
    queryKey: keys.allNotices(filters),
    queryFn: () => apiGet<Page<NoticeListRow>>(`/notices${queryString(filters)}`),
  });
}

export function useAllLinks(filters: ListFilters = {}) {
  return useQuery<Page<LinkListRow>, ApiError>({
    queryKey: keys.allLinks(filters),
    queryFn: () => apiGet<Page<LinkListRow>>(`/links${queryString(filters)}`),
  });
}

export function useAllConsents(filters: ListFilters = {}) {
  return useQuery<Page<ConsentListRow>, ApiError>({
    queryKey: keys.allConsents(filters),
    queryFn: () => apiGet<Page<ConsentListRow>>(`/consents${queryString(filters)}`),
  });
}

/**
 * One consent record, staff view.
 *
 * Three calls rather than one fat endpoint: the artefact is cheap and always
 * wanted, the grants are cheap and almost always wanted, and the asset reverse
 * lookup is the expensive one that only matters when somebody is answering an
 * erasure request. Splitting them means the page paints before the third
 * returns.
 */
export function useConsent(uuid: Uuid | undefined) {
  return useQuery<ConsentArtefact, ApiError>({
    queryKey: keys.consent(uuid ?? ""),
    queryFn: () => apiGet<ConsentArtefact>(`/consents/${uuid}`),
    enabled: Boolean(uuid),
  });
}

export function useConsentGrants(uuid: Uuid | undefined) {
  return useQuery<PurposeGrant[], ApiError>({
    queryKey: keys.consentGrants(uuid ?? ""),
    queryFn: () => apiGet<PurposeGrant[]>(`/consents/${uuid}/grants`),
    enabled: Boolean(uuid),
  });
}

export function useConsentAssets(uuid: Uuid | undefined) {
  return useQuery<ConsentAsset[], ApiError>({
    queryKey: keys.consentAssets(uuid ?? ""),
    queryFn: () => apiGet<ConsentAsset[]>(`/consents/${uuid}/assets`),
    enabled: Boolean(uuid),
    // A 403 here is a scope answer, not a transient failure. Retrying it just
    // writes more access-denial rows into the audit trail.
    retry: false,
  });
}

export function useAllExports(filters: ListFilters = {}) {
  return useQuery<Page<ExportListRow>, ApiError>({
    queryKey: keys.allExports(filters),
    queryFn: () => apiGet<Page<ExportListRow>>(`/exports${queryString(filters)}`),
  });
}

export function useAllCollections(filters: ListFilters = {}) {
  return useQuery<Page<CollectionListRow>, ApiError>({
    queryKey: keys.allCollections(filters),
    queryFn: () => apiGet<Page<CollectionListRow>>(`/collections${queryString(filters)}`),
  });
}

export function useAllSites(filters: ListFilters = {}) {
  return useQuery<Page<SiteListRow>, ApiError>({
    queryKey: keys.allSites(filters),
    queryFn: () => apiGet<Page<SiteListRow>>(`/sites${queryString(filters)}`),
  });
}

export function useAllApprovals(filters: ListFilters = {}) {
  return useQuery<Page<ApprovalListRow>, ApiError>({
    queryKey: keys.allApprovals(filters),
    queryFn: () => apiGet<Page<ApprovalListRow>>(`/approvals${queryString(filters)}`),
  });
}

/* ------------------------------------------------------------- registry writes */
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

export function useRevokeLink() {
  const qc = useQueryClient();
  return useMutation<{ ok: boolean; message?: string }, ApiError, Uuid>({
    mutationFn: (uuid) => apiPost(`/links/${uuid}/revoke`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["all", "links"] });
      void qc.invalidateQueries({ queryKey: ["project"] });
    },
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

/* ------------------------------------------------------------------- users */
export function useDeactivateUser() {
  const qc = useQueryClient();
  return useMutation<{ ok: boolean; message?: string }, ApiError, Uuid>({
    mutationFn: (uuid) => apiPost(`/users/${uuid}/deactivate`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["users"] }),
  });
}

export function useReactivateUser() {
  const qc = useQueryClient();
  return useMutation<{ ok: boolean; message?: string }, ApiError, Uuid>({
    mutationFn: (uuid) => apiPost(`/users/${uuid}/reactivate`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["users"] }),
  });
}

/* -------------------------------------------------------------- audit verify */
export function useVerifyAudit() {
  return useAuditVerify;
}

/* ------------------------------------------------------------ notifications */
/**
 * The notification feed.
 *
 * Typed as audit entries because that is exactly what they are — the endpoint
 * derives the feed from the trail rather than keeping a second table that could
 * disagree with it. Typing it as such is what lets the same detail renderer
 * serve both surfaces.
 */
export function useNotifications(limit = 50) {
  return useQuery<{ items: AuditEntry[]; total: number }, ApiError>({
    queryKey: keys.notifications,
    queryFn: () => apiGet(`/notifications?limit=${limit}`),
  });
}

/* --------------------------------------------------------------- sessions */
export function useSessions() {
  return useQuery<SessionInfo[], ApiError>({
    queryKey: ["auth", "sessions"],
    queryFn: () => apiGet<SessionInfo[]>("/auth/sessions"),
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
