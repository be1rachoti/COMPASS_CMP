/**
 * Layout for every authenticated page.
 *
 * `RequireAuth` renders nothing until the session resolves, so a protected page
 * never flashes its contents before redirecting. A flash of a project list is a
 * disclosure, however brief.
 */
"use client";

import { AppShell } from "@/components/layout/app-shell";
import { SessionWarning } from "@/components/security";
import { Skeleton } from "@/components/ui/primitives";
import { RequireAuth } from "@/providers";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <RequireAuth fallback={<ShellSkeleton />}>
      <AppShell>{children}</AppShell>
      {/* Outside the shell so it survives a page-level error boundary: a
          session about to end is exactly when somebody needs to be told. */}
      <SessionWarning />
    </RequireAuth>
  );
}

/** Mirrors the real shell's geometry so nothing jumps when it resolves. */
function ShellSkeleton() {
  return (
    <div className="min-h-dvh bg-bg">
      <div className="h-14 border-b border-border bg-surface" />
      <div className="mx-auto flex w-full max-w-[1600px]">
        <div className="hidden w-60 shrink-0 border-r border-border p-3 lg:block">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="mb-1.5 h-9 w-full" />
          ))}
        </div>
        <div className="min-w-0 flex-1 space-y-4 px-4 py-6 sm:px-6 lg:px-8">
          <Skeleton className="h-7 w-56" />
          <Skeleton className="h-4 w-80" />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-24" />
            ))}
          </div>
          <Skeleton className="h-64" />
        </div>
      </div>
    </div>
  );
}
