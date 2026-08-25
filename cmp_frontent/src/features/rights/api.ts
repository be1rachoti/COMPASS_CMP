/**
 * The rights page.
 *
 * Public and unauthenticated: somebody who has not consented to anything, and
 * has no account, still has rights under the Act and still has to be able to
 * read what they are.
 *
 * Served from the API rather than written into the page so the DPO contact and
 * the response-time commitment are the same everywhere they appear — including
 * inside a notice, which is frozen at publication and cannot be corrected
 * later.
 */

import { apiGet } from "@/lib/api";

export interface RightEntry {
  right: string;
  /** The section of the Act it comes from. Cited, not paraphrased. */
  section: string;
  description: string;
}

export interface RightsPayload {
  dpo_contact: string;
  how_to_exercise: RightEntry[];
  withdraw_consent: string;
  response_time: string;
  board_complaint: string;
}

export function getRights(): Promise<RightsPayload> {
  return apiGet<RightsPayload>("/rights");
}
