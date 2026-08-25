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
