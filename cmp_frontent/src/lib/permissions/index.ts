/**
 * What the current user may see, client-side.
 *
 * **This is not access control.** Say it plainly, because the shape of the code
 * invites the opposite reading: it is a function called `can()` that returns a
 * boolean, and it would be very easy for somebody to conclude that guarding a
 * mutation with it is sufficient. It is not, and it never will be — anything
 * running in a browser is under the user's control.
 *
 * What it is for is **not offering an action that will fail**. A button that
 * 403s when pressed is a worse experience than a button that is not there, and
 * it teaches people to distrust the interface.
 *
 * The rules are not duplicated here. `me.nav` comes from the server, computed
 * from the same permission matrix the API enforces with, so this module reads a
 * server answer rather than re-deriving one. The moment it re-derives, it drifts
 * — and drifts silently, because any test would be written against the copy.
 */

import type { Me, Role } from "@/types";

/** The navigation keys the server can return. Mirrors `NAV_BY_ROLE`. */
export type NavKey =
  | "dashboard"
  | "projects"
  | "notices"
  | "purposes"
  | "processors"
  | "sources"
  | "sites"
  | "consents"
  | "links"
  | "exports"
  | "imports"
  | "collections"
  | "approvals"
  | "audit"
  | "users"
  | "notifications"
  | "profile";

/**
 * May this user reach this section?
 *
 * Reads `me.nav` — the server's answer — rather than a local table.
 */
export function canSee(me: Me | null | undefined, section: NavKey): boolean {
  return Boolean(me?.nav.includes(section));
}

/**
 * Is this user one of these roles?
 *
 * For the handful of controls where the section is permitted but the *action*
 * is not — a DCO may read the project list and may not upload an approval.
 * Kept explicit rather than inferred, so the reason is visible at the call site.
 */
export function hasRole(me: Me | null | undefined, ...roles: Role[]): boolean {
  return Boolean(me && roles.includes(me.role));
}

export function isStaff(me: Me | null | undefined): boolean {
  return Boolean(me && me.role !== "data_subject");
}

export function isSubject(me: Me | null | undefined): boolean {
  return me?.role === "data_subject";
}

/**
 * A full session, not a partial one.
 *
 * Between password and MFA the server issues a session that authorises exactly
 * one route. Anything that assumes "signed in" means "signed in" has to check
 * this, not merely that `me` is non-null.
 */
export function isFullyAuthenticated(me: Me | null | undefined): boolean {
  return Boolean(me && me.mfa_verified);
}

/**
 * Seconds until the session expires, or null if there is no session.
 *
 * Used by the idle warning. Returns a number rather than a formatted string so
 * the caller decides how to phrase it.
 */
export function secondsUntilExpiry(me: Me | null | undefined): number | null {
  if (!me?.session_expires_at) return null;
  const expiry = new Date(me.session_expires_at).getTime();
  if (Number.isNaN(expiry)) return null;
  return Math.max(0, Math.round((expiry - Date.now()) / 1000));
}
