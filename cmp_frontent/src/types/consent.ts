/**
 * Consent links, artefacts and grants.
 *
 * Two shapes worth reading closely. `ConsentRow.consent_status` is **derived on
 * every read** from the grants, never stored — a stored status is a second copy
 * of the truth and goes stale the first time a grant changes without it. And a
 * withdrawal is its own artefact rather than an edit, so the earlier record
 * survives as evidence of what was agreed at the time.
 */

import type { ConsentStatus, LanguageCode, LawfulBasis, LinkStatus } from "@/types/enums";
import type { DateOnly, Timestamp, Uuid } from "@/types/primitives";

export interface ConsentLink {
  link_uuid: Uuid;
  expires_at: Timestamp;
  max_uses: number | null;
  use_count: number;
  status: LinkStatus;
  created_at: Timestamp;
  revoked_at: Timestamp | null;
  site_uuid: Uuid;
  site_label: string;
  notice_uuid: Uuid;
  notice_code: string;
  version: number;
}

export interface LinkStats {
  use_count: number;
  max_uses: number | null;
  uses_remaining: number | null;
  /** Everyone who came through the link - including anyone who registered and
   *  abandoned before consenting, who leaves no artefact to trace. */
  registrations: number;
  consents: number;
  withdrawals: number;
  declines: number;
}

export interface ConsentRow {
  consent_uuid: Uuid;
  subject_uuid: Uuid;
  subject_name: string;
  subject_email: string;
  subject_mobile: string | null;
  site_uuid: Uuid;
  site_label: string;
  served_at: Timestamp;
  affirmative_action_at: Timestamp;
  action_type: string;
  is_withdrawal: boolean;
  /** Derived from the grants on every read - never a stored column. */
  consent_status: ConsentStatus;
  granted_count: number;
  refused_count: number;
}

export interface PurposeGrant {
  purpose_uuid: Uuid;
  purpose_code: string;
  name: string;
  description: string;
  uses: string;
  lawful_basis: LawfulBasis;
  data_categories: string[];
  retention_period: string;
  granted: boolean;
}

export interface MyConsent {
  consent_uuid: Uuid;
  project_uuid: Uuid;
  project_name: string;
  notice_uuid: Uuid;
  notice_code: string;
  version: number;
  language_code: LanguageCode;
  affirmative_action_at: Timestamp;
  is_withdrawal: boolean;
  granted_count: number;
  purpose_count: number;
}

export interface WithdrawalResult {
  consent_uuid: Uuid;
  supersedes: Uuid;
  withdrawn_at: Timestamp;
  stopped: string[];
  continuing: string[];
  /** Purposes on an s.7 basis do not stop because consent was withdrawn. */
  continuing_under_other_basis: string[];
  note: string;
}

export interface LinkListRow extends ConsentLink {
  project_uuid: Uuid;
  project_name: string;
  /** Everyone who came through the link, consented or not. */
  registrations: number;
}

export interface ConsentListRow extends ConsentRow {
  project_uuid: Uuid;
  project_name: string;
}

/**
 * One consent record, in full.
 *
 * The evidence trio is the point of this shape: `notice_content_hash` says what
 * she was shown, `served_at` says when the server gave it to her, and
 * `affirmative_action_at` says when she acted on it. Together they are what
 * makes s.5(1) provable rather than asserted.
 */
export interface ConsentArtefact {
  consent_uuid: Uuid;
  subject_uuid: Uuid;
  subject_name: string;
  subject_email: string;
  subject_mobile: string | null;
  project_uuid: Uuid;
  project_name: string;
  site_uuid: Uuid;
  site_label: string;
  notice_uuid: Uuid;
  notice_code: string;
  version: number;
  language_code: LanguageCode;
  notice_content_hash: string;
  served_at: Timestamp;
  affirmative_action_at: Timestamp;
  action_type: string;
  is_withdrawal: boolean;
  created_at: Timestamp;
}

/** An asset this person appears in. The reverse lookup an erasure request needs. */

/** An asset this person appears in. The reverse lookup an erasure request needs. */
export interface ConsentAsset {
  asset_uuid: Uuid;
  asset_type: string;
  source_asset_ref: string;
  storage_ref: string;
  has_unmapped_subjects: boolean;
  created_at: Timestamp;
  subject_role: string | null;
  disposition: string | null;
  disposition_at: Timestamp | null;
  collection_uuid: Uuid;
  collected_on: DateOnly;
  source_code: string;
  source_name: string;
  project_uuid: Uuid;
  project_name: string;
}
