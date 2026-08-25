/**
 * Notices, their purposes and their language renditions.
 */

import type { LanguageCode, NoticeStatus } from "@/types/enums";
import type { Timestamp, Uuid } from "@/types/primitives";

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
