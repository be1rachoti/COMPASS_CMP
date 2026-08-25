/**
 * Warning somebody before their session ends.
 *
 * The server holds an absolute lifetime and a sliding idle timeout, and it is
 * the authority on both — nothing here extends a session or keeps one alive.
 * What this does is stop the specific failure of somebody typing a long notice,
 * pressing Save, and losing it to a 401.
 *
 * Two properties matter:
 *
 * * **It never silently keeps a session alive.** A heartbeat that pings the API
 *   on a timer defeats the idle timeout entirely — the session outlives the
 *   person. Refreshing is an explicit act the user takes.
 * * **It is driven by the server's own expiry**, read from `me.session_expires_at`,
 *   not by a local countdown that would drift.
 */

import { secondsUntilExpiry } from "@/lib/permissions";
import type { Me } from "@/types";

/** Warn this long before expiry. Two minutes is enough to finish a sentence and
 *  press Save; ten would be nagging. */
export const WARN_BEFORE_SECONDS = 120;

/** How often to re-check. The countdown is derived, so this only needs to be
 *  often enough that the displayed number does not visibly lag. */
export const POLL_INTERVAL_MS = 10_000;

export type SessionState =
  | { status: "none" }
  | { status: "active"; secondsLeft: number }
  | { status: "expiring"; secondsLeft: number }
  | { status: "expired" };

export function sessionState(me: Me | null | undefined): SessionState {
  const seconds = secondsUntilExpiry(me);

  if (seconds === null) return { status: "none" };
  if (seconds <= 0) return { status: "expired" };
  if (seconds <= WARN_BEFORE_SECONDS) return { status: "expiring", secondsLeft: seconds };
  return { status: "active", secondsLeft: seconds };
}

/** "1:45", for a countdown the user is watching. */
export function formatCountdown(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.max(0, seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}
