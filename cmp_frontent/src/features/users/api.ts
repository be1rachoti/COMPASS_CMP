/**
 * Every request the users feature makes.
 *
 * No password ever travels through here. A staff account is created without
 * one and the holder sets it through an emailed single-use link, so no
 * administrator learns a colleague's password and none is ever posted from this
 * console.
 */

import { apiGet, apiPatch, apiPost, http, queryString } from "@/lib/api";
import type { Acknowledged, Page, User, Uuid } from "@/types";

export function listUsers(filters: Record<string, unknown> = {}): Promise<Page<User>> {
  return apiGet<Page<User>>(`/users${queryString(filters)}`);
}

export interface UserInput {
  full_name: string;
  email: string;
  role: string;
  username?: string | null;
  mobile?: string | null;
  organization_id?: string | null;
  person_type?: string | null;
}

export function createUser(body: UserInput): Promise<User> {
  return apiPost<User>("/users", body);
}

export function updateUser(uuid: Uuid, body: Partial<UserInput>): Promise<User> {
  return apiPatch<User>(`/users/${uuid}`, body);
}

export function changeUserRole(
  uuid: Uuid,
  body: { role: string; reason?: string },
): Promise<Acknowledged> {
  return apiPost<Acknowledged>(`/users/${uuid}/role`, body);
}

/** Deactivated, never deleted: the audit trail refers to this account. */
export function deactivateUser(uuid: Uuid): Promise<Acknowledged> {
  return apiPost<Acknowledged>(`/users/${uuid}/deactivate`);
}

export function reactivateUser(uuid: Uuid): Promise<Acknowledged> {
  return apiPost<Acknowledged>(`/users/${uuid}/reactivate`);
}

/** Clears the enrolled factor so the user can enrol a new device. */
export function resetMfa(uuid: Uuid): Promise<Acknowledged> {
  return apiPost<Acknowledged>(`/users/${uuid}/mfa/reset`);
}

/** Ends every session this user holds. The response to a lost laptop. */
export async function forceLogout(uuid: Uuid): Promise<Acknowledged> {
  const { data } = await http.delete<Acknowledged>(`/users/${uuid}/sessions`);
  return data;
}
