/**
 * The dashboard's loading state.
 *
 * Mirrors the real layout's geometry so nothing jumps when the data arrives.
 * A skeleton that is the wrong shape is worse than none: the page settles, and
 * the settling is what people notice.
 */

"use client";

import { Skeleton } from "@/components/ui/primitives";

export function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-[104px]" />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Skeleton className="h-64" />
        <Skeleton className="h-64" />
      </div>
      <Skeleton className="h-56" />
    </div>
  );
}
