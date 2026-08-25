/**
 * Showing a control only to somebody it will work for.
 *
 * **These components are not access control**, and it matters that the name
 * does not suggest otherwise. `<Can>` renders or does not render — that is all
 * it does. Anything it hides is one devtools edit away from being visible, and
 * the request that button would send is authorised by the API, on its own,
 * every time.
 *
 * What they are for is not offering an action that will fail. A button that
 * 403s when pressed is a worse experience than a button that is not there: the
 * user has no way to tell whether they did something wrong, whether the system
 * is broken, or whether they were never allowed. Do that a few times and people
 * stop trusting the parts of the interface that *do* work.
 *
 * The decision comes from `me.nav` and `me.role`, both computed by the server
 * from the same permission matrix the API enforces with. Nothing here
 * re-derives a rule — a second copy drifts, and it drifts silently, because any
 * test would be written against the copy.
 */
"use client";

import * as React from "react";

import { canSee, hasRole, isFullyAuthenticated, type NavKey } from "@/lib/permissions";
import { useAuth } from "@/providers";
import type { Role } from "@/types";

/**
 * Render children only if the server says this user may reach this section.
 *
 * ```tsx
 * <Can see="users">
 *   <Button onClick={openInvite}>Invite a colleague</Button>
 * </Can>
 * ```
 *
 * `fallback` is for the cases where absence is confusing. A missing button in a
 * toolbar reads as "not available to me"; a missing column in a table reads as
 * a bug, so a table renders a dash instead.
 */
export function Can({
  see,
  fallback = null,
  children,
}: {
  see: NavKey;
  fallback?: React.ReactNode;
  children: React.ReactNode;
}) {
  const { me } = useAuth();
  return <>{canSee(me, see) ? children : fallback}</>;
}

/**
 * Render children only for these roles.
 *
 * For the handful of controls where the *section* is permitted but the
 * *action* is not — a DCO reads the project list and cannot upload an approval.
 * Kept explicit rather than inferred from nav, so the reason is legible where
 * it is used.
 */
export function RequireRole({
  roles,
  fallback = null,
  children,
}: {
  roles: Role | Role[];
  fallback?: React.ReactNode;
  children: React.ReactNode;
}) {
  const { me } = useAuth();
  const list = Array.isArray(roles) ? roles : [roles];
  return <>{hasRole(me, ...list) ? children : fallback}</>;
}

/**
 * Render children only for a session that has cleared its second factor.
 *
 * Between password and MFA the server issues a session that authorises exactly
 * one route. Code that treats "`me` is not null" as "signed in" is wrong during
 * that window, and the window is where an attacker holding a stolen password
 * lives.
 */
export function RequireFullSession({
  fallback = null,
  children,
}: {
  fallback?: React.ReactNode;
  children: React.ReactNode;
}) {
  const { me } = useAuth();
  return <>{isFullyAuthenticated(me) ? children : fallback}</>;
}

/**
 * The hook form, for the cases a component can't be wrapped — a `disabled`
 * prop, a column list, a conditional inside a `map`.
 *
 * Returns the same answers `<Can>` and `<RequireRole>` render on, so there is
 * one source for the decision rather than two that can disagree.
 */
export function usePermissions() {
  const { me } = useAuth();
  return React.useMemo(
    () => ({
      me,
      can: (section: NavKey) => canSee(me, section),
      is: (...roles: Role[]) => hasRole(me, ...roles),
      isFullySignedIn: isFullyAuthenticated(me),
    }),
    [me],
  );
}
