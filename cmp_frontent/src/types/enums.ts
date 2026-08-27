/**
 * The vocabulary, mirroring the API's 25 PostgreSQL enum types.
 *
 * String unions rather than TypeScript enums: a union compares equal to what
 * comes off the wire with no conversion, and it disappears at build time
 * instead of emitting a runtime object nobody asked for.
 *
 * `tests/unit/types` asserts these against the live `/meta/enums`, so a value
 * added on the server cannot go unnoticed here.
 */

export type Role =
  | "dpo"
  | "dco"
  /** Routes projects collected by a third party, and holds a DCO's authority
   *  across all of them rather than over an assigned set. */
  | "dco_admin"
  /** R&D Collection Owner. A DCO's accountability, for collection the R&D team
   *  does itself — where there is no external processor to route to. */
  | "rco"
  | "rnd_user"
  | "admin"
  | "data_subject";

/** The roles that can be accountable for a data source.
 *
 *  A DPO or an administrator owning a rig would be a category error: ownership
 *  is accountability for collection, so it belongs to the people who do it. */
export const SOURCE_OWNING_ROLES = ["dco", "rco"] as const satisfies readonly Role[];
export type PersonType = "external" | "employee" | "ex_employee" | "vendor";
export type UserStatus = "pending" | "active" | "suspended" | "deactivated";

export type ProjectStatus =
  | "in_draft"
  /** Historical only. Merged into `in_draft`; nothing transitions to it, and
   *  the value survives because status-history rows still name it. Kept in the
   *  union so those rows type-check, and excluded from `PROJECT_STATUSES`. */
  | "under_process"
  | "pending_approval"
  | "approved"
  | "closed";

/** The statuses a project can actually be in — what a filter should offer.
 *
 *  `under_process` is absent on purpose: offering a filter that can only ever
 *  return nothing is worse than not offering it. */
export const PROJECT_STATUSES = [
  "in_draft",
  "pending_approval",
  "approved",
  "closed",
] as const satisfies readonly ProjectStatus[];

export type NoticeAudience = "data_subject" | "employee" | "ex_employee" | "others";

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
