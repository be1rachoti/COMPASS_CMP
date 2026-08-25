/**
 * What has happened lately, from the audit trail.
 *
 * Read from the trail rather than a separate activity table, so it cannot
 * disagree with the record — and so the same detail renderer serves both.
 */

"use client";

import Link from "next/link";
import { EmptyRecords } from "@/components/ui/graphics";
import { Card, CardBody, CardHeader, CardTitle, EmptyState } from "@/components/ui/primitives";
import { formatDateTime, humanise } from "@/lib/format";

export function RecentCard({ items }: { items: Array<Record<string, unknown>> }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent activity</CardTitle>
      </CardHeader>
      <CardBody>
        {items.length === 0 ? (
          <EmptyState
            illustration={<EmptyRecords />}
            title="Nothing recorded yet"
            description="Activity appears here as soon as anything happens on your projects."
          />
        ) : (
          <ol className="relative space-y-4">
            {/* The spine. Decorative - the list is already ordered, and each
                entry carries its own timestamp. */}
            <span
              aria-hidden="true"
              className="absolute bottom-2 left-[5px] top-2 w-px bg-border"
            />
            {items.slice(0, 12).map((item, index) => {
              const label =
                typeof item.event_type === "string"
                  ? humanise(item.event_type.replace(/\./g, " "))
                  : ((item.project_name as string) ??
                    (item.export_type as string) ??
                    "Activity");

              // Where this entry lives. The audit-derived feeds carry a resolved
              // href from the server; the project and export feeds carry a uuid.
              const href =
                (item.entity_href as string | null) ??
                (item.project_uuid ? `/projects/${item.project_uuid}` : null) ??
                (item.export_uuid ? "/exports" : null);

              const body = (
                <>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm group-hover:text-accent-text">{label}</p>
                    {typeof item.actor_name === "string" && (
                      <p className="text-xs text-text-subtle">by {item.actor_name}</p>
                    )}
                    {typeof item.entity_label === "string" && item.entity_label && (
                      <p className="truncate text-xs text-text-muted">{item.entity_label}</p>
                    )}
                  </div>
                  <span className="shrink-0 text-xs tabular text-text-subtle">
                    {formatDateTime(
                      (item.occurred_at as string) ??
                        (item.exported_at as string) ??
                        (item.updated_at as string),
                    )}
                  </span>
                </>
              );

              return (
                <li key={index} className="relative pl-6">
                  <span
                    aria-hidden="true"
                    className="absolute left-0 top-1.5 size-2.5 rounded-full border-2 border-surface bg-border-strong"
                  />
                  {href ? (
                    <Link
                      href={href}
                      className="group -mx-2 flex items-baseline gap-4 rounded-lg px-2 py-1 transition-colors hover:bg-surface-hover"
                    >
                      {body}
                    </Link>
                  ) : (
                    <div className="flex items-baseline gap-4">{body}</div>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </CardBody>
    </Card>
  );
}
