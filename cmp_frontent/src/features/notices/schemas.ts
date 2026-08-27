/**
 * What a valid notice and language rendition look like.
 *
 * These are the strictest schemas in the console, and deliberately so. A notice
 * is frozen and content-hashed at publication — the text a data principal was
 * shown has to be reproducible years later — so a mistake here is not editable
 * afterwards. It is a new notice version, a fresh approval, and every consent
 * gathered against the old one still points at the old one.
 */

import { z } from "zod";

import { httpUrl, optional } from "@/schemas/primitives";

/**
 * The three URLs section 5(1) requires a notice to carry: how to withdraw, how
 * to exercise rights, and how to complain to the Board.
 *
 * They are validated as a group because the failure is a group failure — a
 * notice missing any one of them is not a notice, and telling somebody about
 * one missing URL at a time is three round trips for one problem.
 */
export const noticeSchema = z.object({
  /**
   * Blank means "let the server mint one". Still validated when given, because
   * a code somebody typed by hand has to satisfy the same rule as a minted one.
   */
  notice_code: z
    .string()
    .trim()
    .max(80, "A notice code has to fit in 80 characters")
    .regex(
      /^([A-Za-z0-9][A-Za-z0-9._-]*)?$/,
      "Letters, digits, dot, dash and underscore, starting with a letter or digit",
    )
    .optional(),
  withdraw_url: httpUrl("The withdrawal URL"),
  exercise_rights_url: httpUrl("The rights URL"),
  board_complaint_url: httpUrl("The Board complaint URL"),
  dpo_contact: z
    .string()
    .trim()
    .min(3, "State how the DPO can be reached")
    .max(255, "That is longer than the contact field holds"),
  // Who the notice addresses. Exactly one — a document written for employees
  // and for the public at once is two documents with different obligations
  // wearing one name, and the reader can only be one of them.
  //
  // Optional here and required to publish, which is where the server checks it:
  // a notice can be started before that is settled, but nothing reaches a data
  // principal without it being answered.
  applicable_to: optional(z.string()),
  // An instruction to whoever collects against this notice. Never served to a
  // data principal — it is a note to the collector, not part of what they are
  // given.
  note: optional(z.string().trim().max(4000, "Keep the note under 4,000 characters")),
  change_class: optional(z.string()),
  language_code: z.string().optional(),
  rendered_text: z.string().optional(),
});

export type NoticeValues = z.infer<typeof noticeSchema>;

/**
 * A rendition of a notice in one language.
 *
 * The 50-character floor is a sanity check, not a quality bar — it catches the
 * paste that did not take, which is the realistic failure. Nothing client-side
 * can tell whether a Marathi rendition actually says what the English one says;
 * that is what the approval step is for.
 */
export const languageSchema = z.object({
  language_code: z.string().min(1, "Choose a language"),
  rendered_text: z
    .string()
    .trim()
    .min(50, "The notice text looks too short to be complete")
    .max(20_000, "That is longer than a notice rendition can be"),
});

export type LanguageValues = z.infer<typeof languageSchema>;

export const copyNoticeSchema = z.object({
  source_notice_uuid: z.string().uuid("Choose a notice to copy"),
});

export type CopyNoticeValues = z.infer<typeof copyNoticeSchema>;
