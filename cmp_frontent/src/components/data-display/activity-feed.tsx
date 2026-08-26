/**
 * Recent activity, as audit entries.
 *
 * Built for a specific complaint: the R&D and DCO dashboards showed a list of
 * rows that had changed, which said *that* something happened and never what or
 * by whom. Somebody who saw their project had moved had to go looking elsewhere
 * to find out who moved it.
 *
 * So this renders the same rows, with the same event sentences and the same
 * resolved entity references, as the DPO's audit trail. One record and several
 * views of it, rather than several summaries that can disagree.
 *
 * It is a feed, not a table. The audit page is a table because a DPO
 * investigates it — filters, sorts, paginates. A dashboard panel is read
 * top-to-bottom in a few seconds, so the shape is a timeline: when, what, who,
 * and the thing it was about, in that order because that is the order the
 * questions arrive in.
 */
"use client";

import { ChevronRight } from "lucide-react";
import * as React from "react";

import {
  AuditDetailDialog,
  EntityRef,
  distinctSentence,
} from "@/components/data-display/audit-detail";
import { EmptyRecords } from "@/components/ui/graphics";
import { EmptyState, Skeleton } from "@/components/ui/primitives";
import { StatusBadge } from "@/components/ui/status";
import { formatDateTime, formatRelative, humanise } from "@/lib/format";
import type { AuditEntry } from "@/types";

export function ActivityFeed({
  entries,
  isLoading,
  emptyTitle = "Nothing has happened yet",
  emptyDescription,
  /** Oldest-first for a trail that reads as a story; newest-first for a feed. */
  order = "newest",
}: {
  entries: AuditEntry[] | undefined;
  isLoading?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
  order?: "newest" | "oldest";
}) {
  const [open, setOpen] = React.useState<AuditEntry | null>(null);

  if (isLoading) {
    return (
      <ol className="space-y-3" aria-busy="true">
        {Array.from({ length: 4 }).map((_, i) => (
          <li key={i} className="flex gap-3">
            <Skeleton className="size-2 shrink-0 rounded-full" />
            <div className="min-w-0 flex-1 space-y-1.5">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-3 w-1/3" />
            </div>
          </li>
        ))}
      </ol>
    );
  }

  if (!entries?.length) {
    return (
      <EmptyState
        title={emptyTitle}
        description={emptyDescription}
        illustration={<EmptyRecords />}
      />
    );
  }

  const rows = order === "oldest" ? entries : [...entries];

  return (
    <>
      {/* An ordered list, because the order carries meaning. A screen reader
          announces the position, which is the whole point of a timeline. */}
      <ol className="relative space-y-px">
        {rows.map((entry, index) => (
          <li key={entry.log_uuid} className="relative">
            {/* The connecting rail. Drawn per item rather than as one absolute
                element so it cannot drift out of step when a row wraps. */}
            {index < rows.length - 1 && (
              <span
                aria-hidden="true"
                className="absolute left-[7px] top-6 h-full w-px bg-border"
              />
            )}

            <button
              type="button"
              onClick={() => setOpen(entry)}
              className="group flex w-full items-start gap-3 rounded-lg px-2 py-2.5 text-left transition-colors hover:bg-bg-inset focus-visible:bg-bg-inset focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-subtle)]"
            >
              <span
                aria-hidden="true"
                className="relative z-10 mt-1.5 size-[15px] shrink-0 rounded-full border-2 border-bg bg-accent/70 ring-1 ring-border"
              />

              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <span className="text-sm font-medium text-text">
                    {humanise(entry.event_type.replace(/\./g, " "))}
                  </span>
                  <time
                    dateTime={entry.occurred_at}
                    title={formatDateTime(entry.occurred_at)}
                    className="text-xs text-text-subtle"
                  >
                    {formatRelative(entry.occurred_at)}
                  </time>
                </span>

                {distinctSentence(entry) && (
                  <span className="mt-0.5 block text-xs leading-relaxed text-text-muted">
                    {distinctSentence(entry)}
                  </span>
                )}

                <span className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                  {/* "By whom" was the missing half of the original complaint,
                      so it is on the row rather than behind the dialog. */}
                  {entry.actor_name ? (
                    <span className="inline-flex items-center gap-1.5 text-text-muted">
                      {entry.actor_name}
                      {entry.actor_role && (
                        <StatusBadge kind="role" value={entry.actor_role} dot={false} />
                      )}
                    </span>
                  ) : (
                    <span className="text-text-subtle">system</span>
                  )}
                  <EntityRef entry={entry} />
                </span>
              </span>

              <ChevronRight
                className="mt-1 size-4 shrink-0 text-text-subtle opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
                aria-hidden="true"
              />
            </button>
          </li>
        ))}
      </ol>

      <AuditDetailDialog entry={open} onClose={() => setOpen(null)} />
    </>
  );
}
