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
  /** The shareable path, where the link can still be recovered.
   *
   *  `null` for anything minted before links were sealed — those tokens were
   *  never kept. Render that as "not available and here is how to get one",
   *  never as an empty link. */
  url_path: string | null;
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

/**
 * The notice as it was served, for the person it was served to.
 *
 * Read from the copy taken at capture, not from the live notice. Joining live
 * would let a later correction silently repoint somebody's record at words they
 * never saw, which would make the record evidence of the wrong thing.
 *
 * `hash_matches` is the check that says whether that copy is still intact, and
 * `integrity` is the server's own wording for it — carried rather than
 * re-phrased here, so a data principal and an auditor read the same sentence.
 */
export interface MyConsentNotice {
  consent_uuid: Uuid;
  notice_uuid: Uuid;
  notice_code: string;
  version: number;
  language_code: LanguageCode;
  rendered_text: string;
  served_at: Timestamp;
  notice_content_hash: string;
  content_hash: string;
  hash_matches: boolean;
  integrity: string;
  withdraw_url: string;
  exercise_rights_url: string;
  board_complaint_url: string;
  dpo_contact: string;
  recipients_text: string | null;
}

/**
 * One disclosure of this person's data.
 *
 * s.11(1)(b): a data principal may ask who their data has been shared with.
 * Answered from the export record rather than from an archive, so the answer is
 * derived from what actually left the system.
 */
export interface Disclosure {
  export_uuid: Uuid;
  export_type: string;
  exported_at: Timestamp;
  project_uuid: Uuid;
  project_name: string;
  site_uuid: Uuid;
  site_label: string;
  /** Null where the site has no processor — collected directly. */
  processor_name: string | null;
}

/**
 * One step in a consent's own history.
 *
 * A withdrawal supersedes rather than replaces, so this reads as a chain:
 * `supersedes_consent_uuid` points at the artefact this one replaced, and the
 * earliest link has none.
 */
export interface ConsentHistoryEntry {
  consent_uuid: Uuid;
  supersedes_consent_uuid: Uuid | null;
  language_code: LanguageCode;
  served_at: Timestamp;
  affirmative_action_at: Timestamp;
  action_type: string;
  is_withdrawal: boolean;
  granted_count: number;
  purpose_count: number;
}
