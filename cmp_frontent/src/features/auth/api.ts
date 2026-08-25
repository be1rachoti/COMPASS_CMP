/**
 * Signing in, proving a second factor, and managing one's own credentials.
 *
 * Two things about this module are deliberate and easy to undo by accident.
 *
 * **No response here says whether an account exists.** The API answers
 * identically for a wrong password and an unknown login, and for a code sent to
 * a registered contact and one that is not. Nothing in this file should start
 * distinguishing them in a return type or an error branch, because that puts
 * the distinction back into the client where an attacker can read it.
 *
 * **The session never appears in JavaScript.** It arrives as an HttpOnly
 * cookie, is sent by the browser, and is not readable here — which is why there
 * is no `getToken` and no place to put one.
 */

import { apiDelete, apiGet, apiPost } from "@/lib/api";
import type { Acknowledged, LoginResponse, Me, SessionInfo, Uuid } from "@/types";

/* -------------------------------------------------------------- sign-in */

export interface PasswordCredentials {
  login: string;
  password: string;
}

/**
 * Exchange a password for a session.
 *
 * A `mfa_required: true` response still sets a cookie — a *partial* session
 * that authorises exactly one route, the verify step. Treating it as "signed
 * in" is the mistake `isFullyAuthenticated` exists to prevent.
 */
export function signInWithPassword(body: PasswordCredentials): Promise<LoginResponse> {
  return apiPost<LoginResponse>("/auth/login", body);
}

/** Ask for a one-time code. Answers the same way whether the contact is known. */
export function requestOtp(body: { contact: string }): Promise<Acknowledged> {
  return apiPost<Acknowledged>("/auth/otp/request", body);
}

export function verifyOtp(body: { contact: string; code: string }): Promise<Acknowledged> {
  return apiPost<Acknowledged>("/auth/otp/verify", body);
}

/* ------------------------------------------------------------------ mfa */

export function verifyMfa(body: { code: string }): Promise<Acknowledged> {
  return apiPost<Acknowledged>("/auth/mfa/verify", body);
}

export function resendMfa(): Promise<Acknowledged> {
  return apiPost<Acknowledged>("/auth/mfa/resend");
}

/* -------------------------------------------------------------- session */

/** Who the caller is, and what the server says they may reach. */
export function getMe(): Promise<Me> {
  return apiGet<Me>("/auth/me");
}

export function signOut(): Promise<Acknowledged> {
  return apiPost<Acknowledged>("/auth/logout");
}

export function listSessions(): Promise<SessionInfo[]> {
  return apiGet<SessionInfo[]>("/auth/sessions");
}

/** End one session — the one on the laptop somebody left on a train. */
export function revokeSession(uuid: Uuid): Promise<Acknowledged> {
  return apiDelete<Acknowledged>(`/auth/sessions/${uuid}`);
}

/* ------------------------------------------------------------- password */

export interface PasswordChange {
  current_password: string;
  new_password: string;
}

export function changePassword(body: PasswordChange): Promise<Acknowledged> {
  return apiPost<Acknowledged>("/auth/password/change", body);
}

/**
 * Ask for a reset code.
 *
 * Answers the same way whether the address is registered or not — which is why
 * the confirmation screen says "if that address is registered" rather than
 * "check your email". Saying the latter would confirm the account exists to
 * anybody who types an address in.
 */
export function requestPasswordReset(body: { email: string }): Promise<Acknowledged> {
  return apiPost<Acknowledged>("/auth/password/reset/request", body);
}

export interface PasswordResetConfirm {
  email: string;
  /** The code from the email. Digits only, 4-10 of them. */
  code: string;
  new_password: string;
}

/**
 * Set a new password with the code.
 *
 * The email is sent again alongside the code because the code alone is not an
 * identifier — the server needs both to know whose password is being set, and
 * requiring the pair means a leaked code is useless without knowing the account
 * it belongs to.
 */
export function confirmPasswordReset(body: PasswordResetConfirm): Promise<Acknowledged> {
  return apiPost<Acknowledged>("/auth/password/reset/confirm", body);
}
