/**
 * API types.
 *
 * Hand-written rather than generated, for one reason: `npm run api:types`
 * regenerates `src/lib/api-schema.d.ts` from the live OpenAPI document, and these
 * are the *curated* views the UI actually works with. Generated types change
 * shape whenever the backend adds an optional field; these change when we decide
 * they should.
 *
 * Two conventions carried over from the API and enforced here:
 *
 * - Every identifier is a `Uuid`. There is no numeric id in any of these types
 *   because there is no numeric id in any response.
 * - Every list is a `Page<T>`, cursor-paginated. There is no `offset`.
 */

export type Uuid = string;
/** ISO-8601 with offset. Always parse with `new Date(...)`, never slice. */
export type Timestamp = string;
export type DateOnly = string;

/* ------------------------------------------------------------- enumerations */
export type Role = "dpo" | "dco" | "rnd_user" | "admin" | "data_subject";
export type PersonType = "external" | "employee" | "ex_employee" | "vendor";
export type UserStatus = "pending" | "active" | "suspended" | "deactivated";

export type ProjectStatus =
  | "in_draft"
  | "under_process"
  | "pending_approval"
  | "approved"
  | "closed";

export type PurposeStatus = "draft" | "pending_approval" | "active" | "retired";
export type NoticeStatus = "draft" | "approved" | "published" | "superseded";
export type LawfulBasis = "consent_s6" | "legitimate_use_s7";
export type S7Clause = "s7_a_voluntary" | "s7_i_employment" | "s7_other";
export type RecordStatus = "active" | "suspended" | "terminated";
export type LinkStatus = "active" | "expired" | "revoked";
export type ExportType = "collection_pack" | "consented_list";
export type BatchStatus = "received" | "validating" | "accepted" | "partial" | "rejected";
export type AssetType = "image" | "video" | "audio" | "sensor" | "document" | "other";
export type SubjectRole = "consented" | "incidental" | "unidentified";
export type Disposition = "active" | "redacted" | "erased" | "quarantined";
export type ConsentStatus = "consented" | "partial" | "declined" | "withdrawn";
export type LanguageCode =
  | "english"
  | "hindi"
  | "marathi"
  | "tamil"
  | "telugu"
  | "kannada"
  | "bengali"
  | "gujarati";

/* ------------------------------------------------------------------ envelope */
export interface Page<T> {
  items: T[];
  /** Opaque and signed. Pass back as `?cursor=`; never construct one. */
  next_cursor: string | null;
  total: number | null;
}

export interface Acknowledged {
  ok: boolean;
  message?: string | null;
}

/* -------------------------------------------------------------------- identity */
export interface Me {
  uuid: Uuid;
  full_name: string;
  email: string;
  role: Role;
  person_type: PersonType | null;
  status: UserStatus;
  mfa_verified: boolean;
  session_expires_at: Timestamp;
  /** What this role may navigate to. Rendered from here, not from a local copy
   *  of the permission matrix that would drift from the server's. */
  nav: string[];
}

export interface LoginResponse {
  mfa_required: boolean;
  user_uuid: Uuid | null;
  message: string;
}

export interface SessionInfo {
  uuid: Uuid;
  created_at: Timestamp;
  last_seen_at: Timestamp;
  expires_at: Timestamp;
  ip_address: string | null;
  user_agent: string | null;
  mfa_verified: boolean;
  current: boolean;
}

export interface User {
  uuid: Uuid;
  username: string | null;
  full_name: string;
  email: string;
  mobile: string | null;
  organization_id: string | null;
  role: Role;
  person_type: PersonType | null;
  status: UserStatus;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface PersonTypeHistoryEntry {
  history_uuid: Uuid;
  from_type: PersonType | null;
  to_type: PersonType;
  reason: string | null;
  changed_at: Timestamp;
  changed_by_uuid: Uuid;
  changed_by_name: string;
}

/* -------------------------------------------------------------------- registry */
export interface Purpose {
  purpose_uuid: Uuid;
  purpose_code: string;
  version: number;
  status: PurposeStatus;
  name: string;
  description: string;
  /** Rule 3(b)(ii): the specific uses this purpose enables. */
  uses: string;
  lawful_basis: LawfulBasis;
  s7_clause: S7Clause | null;
  /** Rule 3(b)(i): itemised. Never empty. */
  data_categories: string[];
  retention_period: string;
  retention_basis: string;
  erasure_trigger: string;
  consent_validity_period: string | null;
  cross_border_permitted: boolean;
  permitted_for_minors: boolean;
  lapse_behaviour: string;
  created_at: Timestamp;
  updated_at: Timestamp;
  /** Present only on a notice's purpose list. */
  is_mandatory?: boolean;
  display_order?: number;
}

export interface Processor {
  processor_uuid: Uuid;
  legal_name: string;
  type: string;
  contract_ref: string;
  /** Rule 6(1)(f). */
  security_confirmed_at: DateOnly;
  status: RecordStatus;
  created_at: Timestamp;
  sites?: number;
}

export interface DataSource {
  source_uuid: Uuid;
  source_code: string;
  name: string;
  source_role: string;
  exchange_mode: string;
  id_scheme: string | null;
  /** Which elements this source owns. Without it a nightly sync overwrites a
   *  value corrected under a rights request. */
  is_authoritative_for: string[];
  status: RecordStatus;
  created_at: Timestamp;
  processor_uuid?: Uuid | null;
  processor_name?: string | null;
}

/* -------------------------------------------------------------------- projects */
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

/* --------------------------------------------------------------------- notices */
export interface Notice {
  notice_uuid: Uuid;
  notice_code: string;
  version: number;
  withdraw_url: string;
  exercise_rights_url: string;
  /** The Data Protection Board portal, NOT the internal grievance form. */
  board_complaint_url: string;
  dpo_contact: string;
  /** Generated from the project's sites at publication, never typed. */
  recipients_text: string | null;
  status: NoticeStatus;
  change_class: string | null;
  published_at: Timestamp | null;
  created_at: Timestamp;
  updated_at: Timestamp;
  purpose_count?: number;
  language_count?: number;
}

export interface NoticeLanguage {
  notice_language_uuid: Uuid;
  language_code: LanguageCode;
  rendered_text?: string;
  /** sha256 of the exact text served. Copied into each artefact at capture. */
  content_hash: string;
  approved_at: Timestamp | null;
  approved_by_uuid: Uuid | null;
  approved_by_name: string | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

/** Exactly what is blocking publication - a list, not a failed submit. */
export interface NoticeChecklist {
  publishable: boolean;
  blocking: string[];
  purpose_count: number;
  language_count: number;
  approved_language_count: number;
  site_count: number;
}

/* --------------------------------------------------------------------- consent */
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

/* -------------------------------------------------------------------- exchange */
export interface ExportRecord {
  export_uuid: Uuid;
  export_type: ExportType;
  exported_at: Timestamp;
  row_count: number;
  file_hash: string;
  line_count?: number;
  site_uuid?: Uuid;
  site_label?: string;
  exported_by_name?: string;
}

export interface ExportLine {
  subject_uuid: Uuid;
  subject_name: string;
  subject_email: string;
  consent_uuid: Uuid;
  affirmative_action_at: Timestamp;
}

export interface ImportBatch {
  batch_uuid: Uuid;
  file_name: string;
  declared_rows: number;
  accepted_rows: number;
  rejected_rows: number;
  status: BatchStatus;
  received_at: Timestamp;
  source_uuid: Uuid;
  source_code: string;
  project_uuid: Uuid | null;
  project_name: string | null;
}

export interface ImportValidation {
  valid: boolean;
  declared_rows: number;
  error_count: number;
  errors: Array<{ row: number; field: string; error: string }>;
  file_sha256: string;
  already_imported: boolean;
  previous_batch_uuid: Uuid | null;
}

export interface Collection {
  collection_uuid: Uuid;
  source_collection_ref: string;
  collected_on: DateOnly;
  declared_asset_count: number;
  mapped_asset_count: number;
  agent_ref: string | null;
  created_at: Timestamp;
  source_uuid: Uuid;
  source_code: string;
  source_name: string;
  site_uuid: Uuid | null;
  site_label: string | null;
}

/** Declared against mapped. The failure mode is not a rejected file - it is 500
 *  declared and 480 mapped, with 20 in an unlawful state nobody sees. */
export interface CollectionExceptions {
  declared_asset_count: number;
  mapped_asset_count: number;
  unaccounted: number;
  flagged_asset_count: number;
  bystander_rows: number;
  reconciled: boolean;
  flagged_assets: Array<{
    asset_uuid: Uuid;
    source_asset_ref: string;
    asset_type: AssetType;
    subject_count: number;
  }>;
}

export interface AssetSubject {
  subject_role: SubjectRole;
  disposition: Disposition | null;
  disposition_at: Timestamp | null;
  created_at: Timestamp;
  /** Null for a bystander: someone in frame who never consented. INV-12. */
  consent_uuid: Uuid | null;
  subject_uuid: Uuid | null;
  subject_name: string | null;
}

/* ----------------------------------------------------------------------- audit */
export interface AuditEntry {
  log_uuid: Uuid;
  event_type: string;
  /** The table name, exactly. */
  entity_type: string;
  entity_id: number;
  occurred_at: Timestamp;
  detail: Record<string, unknown> | null;
  actor_uuid: Uuid | null;
  actor_name: string | null;
  actor_role: Role | null;
  subject_uuid: Uuid | null;
  subject_name: string | null;

  /* The trail stores `notice#42` because that reference never goes stale. The
   * server resolves it at read time into something a person can read and click.
   * All four are null once the row it describes has been deleted — the trail
   * outlives what it records, which is the whole point of it. */
  entity_uuid: Uuid | null;
  entity_label: string | null;
  /** "Notice", "Consent record", "Project" — what kind of thing this is. */
  entity_noun: string | null;
  /** In-app path, or null where the product has no page for that thing. */
  entity_href: string | null;
}

export interface AuditVerification {
  intact: boolean;
  rows_checked: number;
  last_log_id: number | null;
  first_break: { log_id: number; occurred_at: Timestamp; reason: string } | null;
  message: string;
}

/* ------------------------------------------------------------------ dashboard */
export interface DashboardData {
  role: Role;
  counts: Record<string, number>;
  queues: Array<{ name: string; items: Array<Record<string, unknown>> }>;
  recent: Array<Record<string, unknown>>;
}

/* ----------------------------------------------------------------------- meta */
export interface EnumValue {
  value: string;
  label: string;
}

export type EnumMap = Record<string, EnumValue[]>;

export interface DataCategory {
  value: string;
  label: string;
  group: string;
}

/* --------------------------------------------------------------- public flow */
export interface LinkView {
  valid: boolean;
  project_name: string;
  site_label: string;
  notice_uuid: Uuid;
  available_languages: LanguageCode[];
}

export interface ServedNotice {
  notice: {
    uuid: Uuid;
    code: string;
    version: number;
    withdraw_url: string;
    exercise_rights_url: string;
    board_complaint_url: string;
    dpo_contact: string;
    recipients_text: string | null;
  };
  project_name: string;
  site_label: string;
  language_code: LanguageCode;
  rendered_text: string;
  content_hash: string;
  purposes: Purpose[];
  /** Server-stamped. Must be echoed back with the consent - s.5(1) depends on it. */
  served_at: Timestamp;
}


/* ==========================================================================
   Cross-project console list rows.

   These extend the per-project shapes with the project each row belongs to,
   because a list that spans projects is unreadable without it.
   ========================================================================== */

export interface NoticeListRow {
  notice_uuid: Uuid;
  notice_code: string;
  version: number;
  status: NoticeStatus;
  published_at: Timestamp | null;
  created_at: Timestamp;
  updated_at: Timestamp;
  project_uuid: Uuid;
  project_name: string;
  purpose_count: number;
  language_count: number;
  /** Renditions still awaiting legal approval - the usual blocker. */
  unapproved_languages: number;
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

export interface ExportListRow extends ExportRecord {
  project_uuid: Uuid;
  project_name: string;
}

export interface CollectionListRow {
  collection_uuid: Uuid;
  source_collection_ref: string;
  collected_on: DateOnly;
  declared_asset_count: number;
  mapped_asset_count: number;
  /** Declared minus mapped. Non-zero means assets nobody has accounted for. */
  unaccounted: number;
  agent_ref: string | null;
  created_at: Timestamp;
  source_uuid: Uuid;
  source_code: string;
  source_name: string;
  project_uuid: Uuid;
  project_name: string;
  site_uuid: Uuid | null;
  site_label: string | null;
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

/* --------------------------------------------- collection & import detail */

/** One collection, in full. Adds the originating batch and the reconciliation gap. */
export interface CollectionDetail extends Collection {
  batch_uuid: Uuid;
  /** Declared minus mapped. Non-zero means assets nobody has accounted for. */
  unaccounted: number;
  project_uuid: Uuid;
  project_name: string;
}

export interface CollectionAsset {
  asset_uuid: Uuid;
  source_asset_ref: string;
  asset_type: AssetType;
  storage_ref: string;
  has_unmapped_subjects: boolean;
  created_at: Timestamp;
  subject_count: number;
  /** Rows with no consent behind them: someone in frame who never consented. */
  bystander_count: number;
}

export interface ImportBatchDetail extends ImportBatch {
  file_hash: string;
  source_name: string;
  imported_by_uuid: Uuid;
  imported_by_name: string;
}

export interface ImportErrorReport {
  batch_uuid: Uuid;
  status: BatchStatus;
  declared_rows: number;
  accepted_rows: number;
  rejected_rows: number;
  errors: Array<{ row?: number; field?: string; error?: string; [key: string]: unknown }>;
}

/** A notice that references a purpose. What blocks retirement, and why. */
export interface PurposeUsageEntry {
  notice_uuid: Uuid;
  notice_code: string;
  version: number;
  status: NoticeStatus;
  published_at: Timestamp | null;
  project_uuid: Uuid;
  project_name: string;
  is_mandatory: boolean;
}
