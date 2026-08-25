/**
 * Components that gate on who the viewer is.
 *
 * None of these is a security boundary — see `can.tsx` for why the naming is
 * deliberate about that. They exist so the console does not offer somebody an
 * action that will 403, and so nobody loses work to a session that ended
 * without warning.
 */

export { Can, RequireRole, RequireFullSession, usePermissions } from "@/components/security/can";
export { SessionWarning } from "@/components/security/session-warning";
