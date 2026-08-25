/**
 * Every request the projects feature makes.
 *
 * Plain typed functions, no React. The hooks in `queries.ts` and `mutations.ts`
 * decide *when* to call these and what to do with the cache afterwards; this
 * file decides *what to ask for*.
 *
 * Separating the two is worth the extra file for three reasons. The endpoint
 * path for a resource is written once instead of appearing in a hook, a
 * prefetch and a test. A request can be exercised without mounting a component.
 * And the dependency direction stays one-way — a component reaches the network
 * through a hook, which reaches it through here, which reaches it through the
 * one API client. Nothing skips a step.
 */

import { apiDownload, apiGet, apiPost, apiPut, http, queryString } from "@/lib/api";
import type {
  Acknowledged,
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
import type { ListFilters } from "@/lib/query";

/**
 * Somebody who may be nominated as a Data Collection Owner.
 *
 * Deliberately not a `User`: this endpoint is reachable by an R&D User who has
 * no permission to read the account register, so it returns the three fields a
 * nomination needs and nothing else.
 */
export interface Nominee {
  uuid: Uuid;
  full_name: string;
  email: string;
}

/* --------------------------------------------------------------- filters */

export interface ProjectFilters extends Record<string, unknown> {
  status?: string;
  q?: string;
  limit?: number;
  cursor?: string;
  sort?: string;
}

/* ----------------------------------------------------------------- reads */

export function listProjects(filters: ProjectFilters = {}): Promise<Page<Project>> {
  return apiGet<Page<Project>>(`/projects${queryString(filters)}`);
}

export function getProject(uuid: Uuid): Promise<Project> {
  return apiGet<Project>(`/projects/${uuid}`);
}

export function getProjectSummary(uuid: Uuid): Promise<ProjectSummary> {
  return apiGet<ProjectSummary>(`/projects/${uuid}/summary`);
}

export function getProjectHistory(uuid: Uuid): Promise<StatusHistoryEntry[]> {
  return apiGet<StatusHistoryEntry[]>(`/projects/${uuid}/history`);
}

/**
 * What this user may do next, and why anything else is blocked.
 *
 * Answered by the server rather than derived here, because the answer depends
 * on approvals, notice state and collection reconciliation — none of which the
 * console has in hand, and all of which would go stale in a local copy.
 */
export function getTransitions(uuid: Uuid): Promise<TransitionsView> {
  return apiGet<TransitionsView>(`/projects/${uuid}/transitions`);
}

export function listProjectApprovals(uuid: Uuid): Promise<Approval[]> {
  return apiGet<Approval[]>(`/projects/${uuid}/approvals`);
}

export function listProjectSites(uuid: Uuid): Promise<Site[]> {
  return apiGet<Site[]>(`/projects/${uuid}/sites`);
}

/** Sites across every project the caller may see. */
export function listSites(filters: ListFilters = {}): Promise<Page<SiteListRow>> {
  return apiGet<Page<SiteListRow>>(`/sites${queryString(filters)}`);
}

/** Approvals across every project the caller may see. */
export function listApprovals(filters: ListFilters = {}): Promise<Page<ApprovalListRow>> {
  return apiGet<Page<ApprovalListRow>>(`/approvals${queryString(filters)}`);
}

/**
 * The Data Collection Owners this user may nominate.
 *
 * A narrow lookup rather than the account register: an R&D User must nominate a
 * DCO and has no permission to read `/users`, so this endpoint exists to make
 * the requirement satisfiable without opening the register to them.
 */
export function listAssignableDcos(): Promise<Nominee[]> {
  return apiGet<Nominee[]>("/users/assignable-dcos");
}

/* ---------------------------------------------------------------- writes */

export interface ProjectInput {
  project_name: string;
  description: string;
  dco_user_uuid: string;
  internal_project_name?: string | null;
  requesting_team?: string | null;
}

export interface TransitionInput {
  to: string;
  reason?: string;
}

export interface TransitionResult {
  from: string;
  to: string;
  occurred_at: string;
}

export function createProject(body: ProjectInput): Promise<Project> {
  return apiPost<Project>("/projects", body);
}

export function updateProject(uuid: Uuid, body: Partial<ProjectInput>): Promise<Project> {
  return apiPut<Project>(`/projects/${uuid}`, body);
}

export function requestTransition(
  projectUuid: Uuid,
  body: TransitionInput,
): Promise<TransitionResult> {
  return apiPost<TransitionResult>(`/projects/${projectUuid}/transition`, body);
}

export function assignDco(uuid: Uuid, body: { dco_user_uuid: string }): Promise<Acknowledged> {
  return apiPost<Acknowledged>(`/projects/${uuid}/dco`, body);
}

export function closeProject(uuid: Uuid, body: { reason?: string }): Promise<Acknowledged> {
  return apiPost<Acknowledged>(`/projects/${uuid}/close`, body);
}

export interface SiteInput {
  site_label: string;
  location?: string | null;
  processor_uuid?: string | null;
  source_uuid?: string | null;
}

export function createSite(projectUuid: Uuid, body: SiteInput): Promise<Site> {
  return apiPost<Site>(`/projects/${projectUuid}/sites`, body);
}

export function updateSite(uuid: Uuid, body: Partial<SiteInput>): Promise<Site> {
  return apiPut<Site>(`/sites/${uuid}`, body);
}

/** Deactivated, never deleted: consent was given against this site. */
export function deactivateSite(uuid: Uuid): Promise<Acknowledged> {
  return apiPost<Acknowledged>(`/sites/${uuid}/deactivate`);
}

export interface AgentInput {
  expires_at: string;
  max_uses?: number | null;
  agent_ref?: string | null;
}

/**
 * A minted capability link.
 *
 * The token is returned **once**, here, and never again — the server stores a
 * hash. A UI that loses it before showing it has destroyed the thing the user
 * asked for.
 */
export interface MintedLink {
  link_uuid: Uuid;
  /** Returned once and never again - the database stores only its keyed digest. */
  token: string;
  url_path: string;
  expires_at: string;
  max_uses: number | null;
  /** What to tell the person holding it. Server-worded, so the caution about
   *  the token being unrecoverable says the same thing everywhere. */
  warning: string;
}

export function assignAgent(siteUuid: Uuid, body: AgentInput): Promise<MintedLink> {
  return apiPost<MintedLink>(`/sites/${siteUuid}/agent`, body);
}

export interface ApprovalUpload {
  approval_type: string;
  reference_no: string;
  approved_on: string;
  proof: File;
}

/**
 * Upload an approval with its proof.
 *
 * Goes through `http` rather than `apiPost` because the payload is multipart:
 * the Content-Type is deliberately left unset so the browser adds the boundary
 * itself, and the client strips its JSON default when it sees a FormData body.
 */
export async function uploadApproval(
  projectUuid: Uuid,
  input: ApprovalUpload,
): Promise<unknown> {
  const body = new FormData();
  body.append("approval_type", input.approval_type);
  body.append("reference_no", input.reference_no);
  body.append("approved_on", input.approved_on);
  body.append("proof", input.proof);

  const { data } = await http.post(`/projects/${projectUuid}/approvals`, body);
  return data;
}

/**
 * Download an approval's proof document.
 *
 * Returns the integrity metadata alongside the bytes rather than just the blob.
 * The served file's hash is compared against the one recorded at upload, and a
 * mismatch means the stored document is not the one that was approved — which
 * the caller has to be able to say out loud, not merely log.
 */
export function downloadApprovalProof(uuid: Uuid) {
  return apiDownload(`/approvals/${uuid}/proof`);
}
