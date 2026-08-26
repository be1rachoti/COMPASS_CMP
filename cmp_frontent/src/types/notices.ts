/**
 * Notices, their purposes and their language renditions.
 */

import type { LanguageCode, NoticeStatus } from "@/types/enums";
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
