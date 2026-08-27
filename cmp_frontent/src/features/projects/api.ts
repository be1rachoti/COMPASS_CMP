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
  ProcessorDecision,
  ProjectProcessor,
  Role,
  SiteSourceAssigned,
  SiteWithOwner,
  StatusHistoryEntry,
  TransitionsView,
  Uuid,
} from "@/types";
import type { ListFilters } from "@/lib/query";

/**
 * Somebody who can be accountable for a data source.
 *
 * Deliberately not a `User`: this endpoint is reachable by people with no
 * permission to read the account register — a DCO Admin routing a project, an
 * R&D owner naming an RCO — so it returns what the choice needs and nothing
 * else.
 *
 * The role is part of that, because it constrains the choice rather than merely
 * describing it: an RCO is accountable for collection the R&D team does itself
 * and a DCO for a third party's, so the two are not interchangeable.
 */
export interface CollectionOwner {
  uuid: Uuid;
  full_name: string;
  email: string;
  role: Role;
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

export function listProjectSites(uuid: Uuid): Promise<SiteWithOwner[]> {
  return apiGet<SiteWithOwner[]>(`/projects/${uuid}/sites`);
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
export function listCollectionOwners(): Promise<CollectionOwner[]> {
  return apiGet<CollectionOwner[]>("/users/collection-owners");
}

/* ---------------------------------------------------------------- writes */

export interface ProjectInput {
  project_name: string;
  description: string;
  /** Who will collect. At least one, and several is ordinary — a study running
   *  at a partner campus and in-house at once names both.
   *
   *  This replaced a nominated DCO. Which *person* is accountable follows from
   *  the data sources chosen under these processors, and those do not exist
   *  yet; naming a DCO here was answering for a decision nobody had taken. */
  processor_uuids: string[];
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

/**
 * Add a collector, or ask the DPO to let you.
 *
 * Which of the two it is depends on where the project is, and the caller does
 * not choose — the response says which happened. In draft it is added outright;
 * once the project is approved (or is being reviewed) it goes on the list
 * pending, and nothing may collect under it until the DPO answers.
 */
export function requestProjectProcessor(
  uuid: Uuid,
  processorUuid: Uuid,
): Promise<ProcessorDecision> {
  return apiPost<ProcessorDecision>(`/projects/${uuid}/processors`, {
    processor_uuid: processorUuid,
  });
}

/** The DPO's answer. A refusal carries a reason; the API refuses one without. */
export function decideProjectProcessor(
  uuid: Uuid,
  processorUuid: Uuid,
  body: { approved: boolean; reason?: string | null },
): Promise<ProcessorDecision> {
  return apiPost<ProcessorDecision>(
    `/projects/${uuid}/processors/${processorUuid}/decision`,
    body,
  );
}

export function listProjectProcessors(uuid: Uuid): Promise<ProjectProcessor[]> {
  return apiGet<ProjectProcessor[]>(`/projects/${uuid}/processors`);
}

/** Draft only. The processors are what the DPO reviewed and what the routing
 *  was decided from, so an approved project cannot be re-pointed. */
export function setProjectProcessors(
  uuid: Uuid,
  processorUuids: string[],
): Promise<ProjectProcessor[]> {
  return apiPut<ProjectProcessor[]>(`/projects/${uuid}/processors`, {
    processor_uuids: processorUuids,
  });
}

export function closeProject(uuid: Uuid, body: { reason?: string }): Promise<Acknowledged> {
  return apiPost<Acknowledged>(`/projects/${uuid}/close`, body);
}

export interface SiteInput {
  /** A site is one data source, deployed on one project.
   *
   *  It is the only required field because everything else follows from it: the
   *  processor (a source belongs to one), the name (a site has none of its own),
   *  and who is accountable (the source carries its owner). Asking for those
   *  separately invited them to disagree. */
  source_uuid: string;
  /** Where it physically stands. Free text, because it is the line a data
   *  principal reads in the notice's recipient list rather than anything the
   *  system reasons about. */
  location?: string | null;
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

/**
 * Attach the data source that stands at a site, or detach it with `null`.
 *
 * The routing action, and deliberately not a way to name a person: the source
 * carries its own owner, so choosing CIT is choosing whoever runs CIT. The
 * project follows — the server re-derives its owner from the primary site — so
 * this is the operation that moves a project between people.
 *
 * The response says whether it actually moved, which is the fact somebody needs
 * before they close the dialog.
 */
/**
 * Name who runs one site, overriding the owner its data source implies.
 *
 * Not a shortcut into `PUT /sources/{uuid}/owner`, and the distinction is the
 * point: that endpoint moves the rig, and with it every project collecting from
 * the rig. This one moves a single site on a single project and leaves the
 * source alone.
 *
 * `null` clears the exception and the site goes back to the source's owner.
 */
export function assignSiteOwner(
  siteUuid: Uuid,
  ownerUserUuid: Uuid | null,
): Promise<SiteSourceAssigned> {
  return apiPut<SiteSourceAssigned>(`/sites/${siteUuid}/owner`, {
    owner_user_uuid: ownerUserUuid,
  });
}

export function assignSiteSource(
  siteUuid: Uuid,
  sourceUuid: Uuid | null,
): Promise<SiteSourceAssigned> {
  return apiPut<SiteSourceAssigned>(`/sites/${siteUuid}/source`, { source_uuid: sourceUuid });
}
