/**
 * Exports, imports, collections and assets.
 *
 * `unaccounted` is the field that matters: declared minus mapped. A rejected
 * import is obvious and gets fixed; the dangerous outcome is 500 declared, 480
 * mapped, and twenty assets in a state nobody is looking at.
 */

import type {
  AssetType,
  BatchStatus,
  Disposition,
  ExportType,
  NoticeStatus,
  SubjectRole,
} from "@/types/enums";
import type { DateOnly, Timestamp, Uuid } from "@/types/primitives";

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
