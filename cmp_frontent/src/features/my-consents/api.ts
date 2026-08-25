/**
 * The data principal's own view of their consents.
 *
 * A separate endpoint set from the staff-facing consent views even where the
 * underlying row is the same, and that separation is the access control: these
 * are scoped to the caller by the server, so there is no uuid a data subject
 * could substitute to read somebody else's record.
 */

import { apiGet, apiPost } from "@/lib/api";
import type {
  ConsentHistoryEntry,
  Disclosure,
  MyConsent,
  MyConsentNotice,
  PurposeGrant,
  Uuid,
  WithdrawalResult,
} from "@/types";

export function listMyConsents(): Promise<MyConsent[]> {
  return apiGet<MyConsent[]>("/me/consents");
}

export function listMyConsentGrants(uuid: Uuid): Promise<PurposeGrant[]> {
  return apiGet<PurposeGrant[]>(`/me/consents/${uuid}/grants`);
}

export function listMyConsentHistory(uuid: Uuid): Promise<ConsentHistoryEntry[]> {
  return apiGet<ConsentHistoryEntry[]>(`/me/consents/${uuid}/history`);
}

/**
 * The notice as it was served.
 *
 * The frozen text, not the current one. What the person agreed to is what they
 * were shown at the time, and showing them today's wording would misrepresent
 * their own record.
 */
export function getMyConsentNotice(uuid: Uuid): Promise<MyConsentNotice> {
  return apiGet<MyConsentNotice>(`/me/consents/${uuid}/notice`);
}

/** Who this person's data has been disclosed to. s.11(1)(b). */
export function listMyDisclosures(): Promise<Disclosure[]> {
  return apiGet<Disclosure[]>("/me/disclosures");
}

/**
 * Withdraw consent.
 *
 * Written as a new artefact rather than an edit to the old one. s.6(6) requires
 * withdrawal to be as easy as giving consent, and s.6(5) requires the earlier
 * record to survive as evidence of what was agreed at the time.
 */
export interface WithdrawInput {
  /** The purposes to withdraw. Omit and set `all` to withdraw every one. */
  purposes?: Uuid[];
  all?: boolean;
}

export function withdrawConsent(
  consentUuid: Uuid,
  body: WithdrawInput,
): Promise<WithdrawalResult> {
  return apiPost<WithdrawalResult>(`/me/consents/${consentUuid}/withdraw`, body);
}
