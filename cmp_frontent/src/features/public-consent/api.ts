/**
 * The public consent flow — the four steps a data principal actually walks.
 *
 * This is the only feature reachable without a session, and the most carefully
 * specified surface in the system. Three properties are load-bearing:
 *
 * **An invalid link never says why.** Expired, revoked, exhausted and mistyped
 * all resolve to the same failure. Naming the reason would tell somebody
 * guessing tokens which of their guesses was structurally valid.
 *
 * **`served_at` is server-stamped and echoed back untouched.** It is what
 * evidences s.5(1) — that the notice was given *before* consent was asked for —
 * and a client-supplied timestamp would make that unfalsifiable.
 *
 * **Accept and decline take the same path.** s.6(1) requires consent to be a
 * free choice, and a decline that is slower, harder or routed differently is
 * not a free choice. `recordConsent` handles both.
 */

import { apiGet, apiPost } from "@/lib/api";
import type { Acknowledged, LanguageCode, LinkView, ServedNotice } from "@/types";

/**
 * How the affirmative action was taken.
 *
 * Recorded because s.6(1) requires consent to be an *act*, and the record has
 * to say which act. The API types this as an open string — it is a vocabulary
 * that grows as capture methods are added — so this union is what the console
 * itself can produce, not a claim about what the column holds.
 */
export type ActionType = "checkbox_click" | "signature" | "verbal_recorded";

/**
 * Resolve a link token.
 *
 * Rejects with a generic error for every failure mode. Callers should render
 * the "not valid" screen without trying to distinguish causes.
 */
export function getLink(token: string): Promise<LinkView> {
  return apiGet<LinkView>(`/c/${token}`);
}

export interface RegistrationInput {
  full_name: string;
  email: string;
  mobile?: string;
  person_type: string;
}

export function register(token: string, body: RegistrationInput): Promise<Acknowledged> {
  return apiPost<Acknowledged>(`/c/${token}/register`, body);
}

export function requestOtp(token: string, contact: string): Promise<Acknowledged> {
  return apiPost<Acknowledged>(`/c/${token}/otp`, { contact });
}

export function verifyOtp(
  token: string,
  body: { contact: string; code: string },
): Promise<Acknowledged> {
  return apiPost<Acknowledged>(`/c/${token}/otp/verify`, body);
}

/**
 * Serve the notice in one language, stamping `served_at`.
 *
 * Called again on every language change — and that is not a wasted request. She
 * is now reading a different rendition, and the evidence has to record which
 * one she was shown and when.
 */
export function serveNotice(token: string, language: LanguageCode): Promise<ServedNotice> {
  return apiGet<ServedNotice>(`/c/${token}/notice?language_code=${language}`);
}

export interface ConsentDecision {
  language_code: LanguageCode;
  /** Echoed back exactly as served. Never re-stamped client-side. */
  served_at: string;
  /** Purpose uuid -> granted. Every purpose is present, including the refused. */
  grants: Record<string, boolean>;
  action_type: ActionType;
}

/**
 * Record the decision — accept or decline, by the same route.
 *
 * `grants` carries every purpose explicitly rather than only the granted ones.
 * An absent key would be indistinguishable from a purpose that was never
 * shown, and "she refused this" and "she was never asked" are different facts
 * that a regulator may one day need told apart.
 */
export function recordConsent(
  token: string,
  body: ConsentDecision,
): Promise<{ consent_uuid: string }> {
  return apiPost<{ consent_uuid: string }>(`/c/${token}/consent`, body);
}
