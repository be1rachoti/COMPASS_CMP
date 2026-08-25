/**
 * The signed-in user acting on their own account.
 *
 * Everything here is scoped to the caller by the server — there is no uuid
 * parameter anywhere in this file, which is what makes that true rather than
 * merely intended.
 */

import { apiGet, apiPatch, apiPost } from "@/lib/api";
import type { Acknowledged, SessionInfo } from "@/types";

/** Every session this account holds, so somebody can spot one they don't recognise. */
export function listMySessions(): Promise<SessionInfo[]> {
  return apiGet<SessionInfo[]>("/auth/sessions");
}

export function updateMe(body: { full_name?: string; mobile?: string }): Promise<unknown> {
  return apiPatch("/me", body);
}

/**
 * Declare whether one is a minor, or acting for one.
 *
 * s.9 turns on this answer, so the change is recorded with a reason rather than
 * silently overwritten — a guardian taking over an account and a subject
 * turning eighteen are different events and the trail should say which.
 */
export function setPersonType(body: {
  person_type: string;
  reason?: string;
}): Promise<Acknowledged> {
  return apiPost<Acknowledged>("/me/person-type", body);
}
