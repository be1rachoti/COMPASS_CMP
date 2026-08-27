/**
 * A page a role has no business on does not render.
 *
 * The sidebar is built from `me.nav`, so a role is never *offered* a section it
 * cannot use. That was the whole guard, and it held exactly as long as every
 * route into the app came from the sidebar. A notification linking to
 * `/users` — which is what a data principal's own registration event resolved
 * to — walked straight past it, and she arrived at the administrator's account
 * register: the API refused every request underneath, so the screen was empty,
 * but it was the admin screen and it had her on it.
 *
 * The link is fixed at the source. This is the second half: whatever produced
 * the URL, the page behind it is not for her.
 *
 * **It is not a security boundary and must not be read as one.** Every one of
 * these routes is enforced server-side by the permission matrix, and that is
 * what actually protects the data. This exists so the product does not show
 * somebody a console that will refuse them — a different problem, and one the
 * server cannot solve because by then the page has already rendered.
 *
 * The permitted set comes from `me.nav`, which the server computes. Not a
 * second list of who-may-see-what: a hardcoded one would drift from the matrix,
 * and the drift would show up as either a locked-out user or exactly the hole
 * this closes.
 */
"use client";

import { ShieldOff } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { Alert, Button } from "@/components/ui/primitives";
import { useAuth } from "@/providers";

/**
 * Route prefixes that belong to a nav section.
 *
 * Only the sections that gate something. A path with no entry here is not
 * guarded — `/profile`, `/cover` and the detail routes under a section already
 * covered by its prefix — because a guard that had to be told about every new
 * page would be one somebody forgets to tell.
 */
const SECTION_OF: ReadonlyArray<readonly [prefix: string, key: string]> = [
  ["/projects", "projects"],
  ["/notices", "notices"],
  ["/purposes", "purposes"],
  ["/processors", "processors"],
  ["/sources", "sources"],
  ["/sites", "sites"],
  ["/consents", "consents"],
  ["/my-consents", "consents"],
  ["/links", "links"],
  ["/exports", "exports"],
  ["/imports", "imports"],
  ["/collections", "collections"],
  ["/approvals", "approvals"],
  ["/audit", "audit"],
  ["/users", "users"],
];

export function RequireSection({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { me } = useAuth();

  // Longest prefix wins, so `/my-consents` is not matched by `/consents`.
  const match = [...SECTION_OF]
    .sort((a, b) => b[0].length - a[0].length)
    .find(([prefix]) => pathname === prefix || pathname.startsWith(`${prefix}/`));

  // No section, or the session has not resolved yet — `RequireAuth` above has
  // already held the render until it did, so this is the un-guarded case.
  if (!match || !me) return <>{children}</>;

  if (me.nav.includes(match[1])) return <>{children}</>;

  return (
    <div className="mx-auto max-w-lg py-16">
      <Alert tone="info" title="Not part of your account">
        <p>
          This section belongs to a different role, so there is nothing here for you.
          Nothing has gone wrong — the link you followed pointed at a staff console.
        </p>
        <div className="mt-4 flex gap-2">
          <Button asChild variant="primary" size="sm">
            <Link href="/dashboard">
              <ShieldOff className="size-4" aria-hidden="true" />
              Back to your dashboard
            </Link>
          </Button>
        </div>
      </Alert>
    </div>
  );
}
