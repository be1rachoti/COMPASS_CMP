/**
 * Whether React has taken over the markup yet.
 *
 * Server-rendered HTML is interactive-looking before it is interactive: the
 * inputs accept typing and the button depresses, but `onSubmit` is not attached
 * until hydration runs. Press the button in that window and the browser
 * performs its own native form submission instead of the handler's.
 *
 * That is not hypothetical here. It happened on a first page load in
 * development, and because the forms had no `method`, HTML's default GET put
 * the password in the query string:
 *
 *     /sign-in?login=dpo%40cmp.local&password=SeedPassw0rd%212026
 *
 * `method="post"` (now on every form, enforced by `app/forms.test.ts`) stops
 * the leak. This closes the other half: a submit control that is disabled until
 * the handler exists cannot fire the native submission at all.
 *
 * On a warm load the disabled state lasts a few milliseconds and nobody sees
 * it. On a cold or throttled one it is honest — the form genuinely is not ready
 * — and that is better than a button that appears to work and does nothing.
 *
 * Note this deliberately returns `false` on the server and on the first client
 * render. Returning `true` initially would produce a hydration mismatch, which
 * React resolves by re-rendering and which would defeat the purpose.
 */
"use client";

import * as React from "react";

export function useHydrated(): boolean {
  return React.useSyncExternalStore(
    // Never notifies: the value transitions once, from the server snapshot to
    // the client one, and that transition is hydration itself.
    () => () => {},
    () => true,
    () => false,
  );
}
