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
