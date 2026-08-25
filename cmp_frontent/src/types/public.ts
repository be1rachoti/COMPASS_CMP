/**
 * The public consent flow.
 *
 * `ServedNotice.served_at` is server-stamped and echoed back untouched. It is
 * what evidences s.5(1) — that the notice was given before consent was asked
 * for — and a client-supplied timestamp would make that unfalsifiable.
 */

import type { LanguageCode } from "@/types/enums";
import type { Timestamp, Uuid } from "@/types/primitives";
import type { Purpose } from "@/types/registry";

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
