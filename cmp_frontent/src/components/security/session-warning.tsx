/**
 * Telling somebody their session is about to end, before it does.
 *
 * The failure this exists to prevent is specific and it is not hypothetical: a
 * DPO spends twenty minutes writing a notice rendition, presses Save, and gets
 * a 401. The work is gone, the sign-in page gives no explanation, and the only
 * signal anything was wrong appeared after the damage.
 *
 * Three rules govern what this may do:
 *
 * 1. **It never keeps a session alive.** There is no heartbeat here. A timer
 *    that pings the API defeats the idle timeout entirely — the session outlives
 *    the person who left the building. Refreshing is an act the user takes.
 * 2. **The server's expiry is the truth.** The countdown is derived from
 *    `me.session_expires_at` on every tick, not decremented locally, so a clock
 *    that drifts or a laptop that slept does not produce a confident wrong
 *    number.
 * 3. **It is announced, not just drawn.** Somebody using a screen reader has to
 *    hear this, and somebody who has tabbed away has to see it on return.
 */
"use client";

import * as React from "react";

import { Button } from "@/components/ui/primitives";
import {
  POLL_INTERVAL_MS,
  formatCountdown,
  sessionState,
  type SessionState,
} from "@/lib/security";
import { useAuth } from "@/providers";

export function SessionWarning() {
  const { me, refresh, signOut } = useAuth();
  const [dismissedAt, setDismissedAt] = React.useState<string | null>(null);

  // The timer's only job is to make the component render again. The state is
  // derived below, from the server's expiry, so it is recomputed on every
  // render for whatever reason - a tick, a new `me`, a parent update - rather
  // than held in a second copy that has to be kept in step with the first.
  const [, tick] = React.useReducer((n: number) => n + 1, 0);
  React.useEffect(() => {
    const id = window.setInterval(tick, POLL_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, []);

  const state: SessionState = sessionState(me);

  // A dismissal applies to one session, not to the browser. Keyed on the expiry
  // so that refreshing - which moves the expiry - brings the warning back when
  // the new session is itself near its end.
  const dismissed = dismissedAt !== null && dismissedAt === me?.session_expires_at;

  if (state.status !== "expiring" || dismissed) return null;

  return (
    <div
      // `alert` rather than `status`: this interrupts, because it has to be
      // acted on before it stops being actionable.
      role="alert"
      aria-live="assertive"
      className="fixed inset-x-0 bottom-0 z-50 flex justify-center p-4 sm:bottom-4"
    >
      <div className="pointer-events-auto flex w-full max-w-lg flex-col gap-3 rounded-xl border border-warning-border bg-warning-subtle p-4 shadow-lg sm:flex-row sm:items-center sm:gap-4">
        <div className="flex-1">
          <p className="text-sm font-semibold text-warning-text">
            Your session ends in {formatCountdown(state.secondsLeft)}
          </p>
          <p className="mt-0.5 text-sm text-warning-text/85">
            Anything unsaved will be lost. Staying signed in does not extend the
            overall session limit.
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button
            variant="ghost"
            onClick={() => setDismissedAt(me?.session_expires_at ?? null)}
          >
            Dismiss
          </Button>
          <Button variant="secondary" onClick={() => void signOut()}>
            Sign out
          </Button>
          <Button variant="primary" onClick={() => void refresh()}>
            Stay signed in
          </Button>
        </div>
      </div>
    </div>
  );
}
