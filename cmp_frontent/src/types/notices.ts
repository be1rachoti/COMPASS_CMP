/**
 * Notices, their purposes and their language renditions.
 */

import type { LanguageCode, NoticeAudience, NoticeStatus } from "@/types/enums";
import type { Timestamp, Uuid } from "@/types/primitives";
import type { Purpose } from "@/types/registry";

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
  /** Who this notice addresses. Exactly one, and required before publication —
   *  a document written for employees and for the public at once is two
   *  documents with different obligations wearing one name. */
  applicable_to: NoticeAudience | null;
  /** An instruction to whoever collects against this notice.
   *
   *  Shown to the DCO and never served to a data principal: it is a note to the
   *  collector, not part of what the person being asked is given. The public
   *  endpoints name their columns explicitly, so this cannot leak by being
   *  added here. */
  note: string | null;
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
  /** Exactly what a data principal reads. Always returned by the per-notice
   *  languages endpoint — this is the notice, and a list of renditions without
   *  it is a list of filenames. */
  rendered_text: string;
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

/**
 * A purpose as one notice states it.
 *
 * `data_categories` and `uses` are the **resolved** values — this notice's
 * override where one exists, the purpose's own otherwise — so a reader never
 * has to know which. That resolution happens in one place, server-side, which
 * is what stops the notice text, the publish checklist and the consent screen
 * disagreeing about what was promised.
 *
 * The `purpose_*` fields carry the shared purpose's own wording, for the one
 * screen that needs it: a DPO deciding what to narrow has to see what they are
 * narrowing from.
 */
export interface PurposeOnNotice extends Purpose {
  display_order: number;
  /** A purpose the data principal cannot refuse without refusing the whole
   *  notice. Rare, and only lawful where the processing is genuinely
   *  inseparable from the service. */
  is_mandatory: boolean;

  purpose_data_categories: string[];
  purpose_uses: string;
  is_overridden: boolean;
  overridden_at: Timestamp | null;
  overridden_by_name: string | null;
}

/**
 * What a dry run of an uploaded notice document reports.
 *
 * Every field here is something the importer read out of the file, so the
 * screen can show the author what the system understood before anything is
 * written. `warnings` is where assumptions surface — a default the importer
 * applied is only acceptable if somebody saw it.
 */
export interface NoticeDocumentReport {
  ok: boolean;
  project_name: string;
  language: string;
  notice_code_in_document: string | null;
  /** The draft this import would overwrite, if the project has one. */
  replaces_draft: string | null;
  rendered_characters: number;
  rendered_excerpt: string;
  data_categories: { id: string; name: string }[];
  purposes: NoticeDocumentPurpose[];
  /**
   * Purposes already in the register that read like these. Reported, never
   * acted on: whether two purposes are the same one is the DPO's call, so the
   * import always creates and this is how they see the candidates.
   */
  possible_duplicates: {
    document_id: string;
    name: string;
    resembles: string;
    resembles_name: string;
    similarity: number;
  }[];
  warnings: string[];
}

export interface NoticeDocumentPurpose {
  document_id: string;
  name: string;
  uses: string;
  data_categories: string[];
  retention_period: string;
  lawful_basis: string;
  /** Whether declining it means not taking part. */
  is_mandatory: boolean;
}
