/**
 * The project lifecycle, its approvals, sites and transitions.
 *
 * `TransitionOption` carries `blocked_by`, and that is the point of it: a
 * blocked transition is shown as a disabled control *with its reason*, never
 * hidden. Hiding it leaves somebody wondering why the thing they were told to
 * do is not there.
 */

import type { ProjectStatus, RecordStatus, Role } from "@/types/enums";
import type { DateOnly, Timestamp, Uuid } from "@/types/primitives";

export interface Project {
  project_uuid: Uuid;
  project_name: string;
  internal_project_name: string | null;
  description: string | null;
  requesting_team: string | null;
  project_status: ProjectStatus;
  dco_uuid: Uuid | null;
  dco_name: string | null;
  created_by_name: string | null;
  current_notice_uuid: Uuid | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

/** What this user may do next, and why anything else is blocked. */
export interface TransitionOption {
  to: ProjectStatus;
  allowed: boolean;
  blocked_by?: string;
  reason_required?: boolean;
  publishes_notice?: boolean;
}

export interface TransitionsView {
  current: ProjectStatus;
  available: TransitionOption[];
}

export interface StatusHistoryEntry {
  history_uuid: Uuid;
  from_status: ProjectStatus | null;
  to_status: ProjectStatus;
  reason: string | null;
  occurred_at: Timestamp;
  actor_uuid: Uuid;
  actor_name: string;
  actor_role: Role;
}

export interface ProjectSummary {
  project_uuid: Uuid;
  project_name: string;
  project_status: ProjectStatus;
  counts: {
    notices: number;
    sites: number;
    approvals: number;
    purposes: number;
    active_links: number;
    exports: number;
    collections: number;
  };
  consents: {
    total: number;
    consented: number;
    partial: number;
    declined: number;
    withdrawn: number;
  };
  readiness: {
    notice_published: boolean;
    rule3_complete: boolean;
    approvals_with_proof: number;
  };
}

export interface Approval {
  approval_uuid: Uuid;
  approval_type: string;
  reference_no: string;
  approved_on: DateOnly;
  proof_file_hash: string;
  uploaded_at: Timestamp;
  uploaded_by_uuid: Uuid;
  uploaded_by_name: string;
}

export interface Site {
  site_uuid: Uuid;
  site_label: string;
  location: string | null;
  status: RecordStatus;
  created_at: Timestamp;
  processor_uuid?: Uuid | null;
  processor_name?: string | null;
  active_links?: number;
  /** Set when adding a site to a project whose notice is already published:
   *  a new recipient requires a new notice version. */
  material_change?: boolean;
  notice?: string | null;
}

export interface SiteListRow {
  site_uuid: Uuid;
  site_label: string;
  location: string | null;
  status: RecordStatus;
  created_at: Timestamp;
  project_uuid: Uuid;
  project_name: string;
  project_status: ProjectStatus;
  processor_uuid: Uuid | null;
  processor_name: string | null;
  active_links: number;
}

export interface ApprovalListRow {
  approval_uuid: Uuid;
  approval_type: string;
  reference_no: string;
  approved_on: DateOnly;
  /** INV-8: proof is mandatory, so this is never absent. */
  proof_file_hash: string;
  uploaded_at: Timestamp;
  project_uuid: Uuid;
  project_name: string;
  project_status: ProjectStatus;
  uploaded_by_uuid: Uuid;
  uploaded_by_name: string;
}

/* ------------------------------------------------------ consent detail --- */

/**
 * One consent record, in full.
 *
 * The evidence trio is the point of this shape: `notice_content_hash` says what
 * she was shown, `served_at` says when the server gave it to her, and
 * `affirmative_action_at` says when she acted on it. Together they are what
 * makes s.5(1) provable rather than asserted.
 */

/**
 * A site, with the source that stands at it and who that source belongs to.
 *
 * The owner is read *through* the source and never recorded on the site. That
 * indirection is the point: the same rig serving three projects has one owner,
 * recorded once, and three copies cannot disagree.
 *
 * `is_primary` marks the site whose owner the project follows — the
 * earliest-registered active one whose source has an owner. Surfaced because a
 * project with three sites and three owners needs to say which of them is
 * deciding, and "the first one" is not something a reader can work out from a
 * list.
 */
export interface SiteWithOwner extends Site {
  source_uuid: Uuid | null;
  source_code: string | null;
  source_name: string | null;
  is_in_house: boolean | null;
  /** Who runs this site: the named override where there is one, otherwise the
   *  owner of its data source. One field, because a screen that had to work
   *  out which of two to show would eventually show the wrong one. */
  dco_uuid: Uuid | null;
  dco_name: string | null;
  dco_email: string | null;
  dco_role: Role | null;
  /** True when `dco_name` is a named exception rather than the source's owner.
   *
   *  Surfaced because the two look identical otherwise, and the difference
   *  matters: an exception is somebody's decision about this project, and the
   *  rig it runs on still belongs to somebody else. */
  owner_overridden: boolean;
  override_by_name: string | null;
  override_at: Timestamp | null;
  /** Who the site would fall back to. What the exception is an exception *to*. */
  source_owner_name: string | null;
  is_primary: boolean;
}

/** What changed when a site's owner or its source was set. */
export interface SiteSourceAssigned {
  ok: boolean;
  /** True when this attachment moved the project to a different owner. The
   *  fact somebody needs before they close the dialog. */
  project_moved: boolean;
  message: string;
}

/** Where a project-to-processor link stands.
 *
 *  Only `approved` counts as one of the project's processors: a `pending` one
 *  is a request and collects nothing, and a `rejected` one is kept — with its
 *  reason — because "we asked and were told no" is a fact somebody will need. */
export type ProcessorRequestStatus = "pending" | "approved" | "rejected";

/** A processor on a project's list, and where it stands. */
export interface ProjectProcessor {
  processor_uuid: Uuid;
  legal_name: string;
  type: string;
  /** The processor's own lifecycle in the registry — active, suspended — as
   *  distinct from `status`, which is where its link to *this project* stands. */
  processor_status: RecordStatus;
  status: ProcessorRequestStatus;
  /** Drives the routing. A third party's project goes to a DCO Admin; an
   *  in-house one goes back to the R&D owner to name an RCO. */
  is_in_house: boolean;
  /** Whether anything is collecting under it yet. An approved processor with no
   *  site is what its collection owner is waiting on. */
  has_site: boolean;
  added_at: Timestamp;
  requested_by_name: string | null;
  decided_at: Timestamp | null;
  decided_by_name: string | null;
  decision_reason: string | null;
}

/** What happened to a request to add a collector. */
export interface ProcessorDecision {
  project_uuid: Uuid;
  processor_uuid: Uuid;
  status: ProcessorRequestStatus;
  message: string;
}
