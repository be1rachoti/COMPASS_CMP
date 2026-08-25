/**
 * A queue: the things waiting for this person.
 *
 * The most important element on the screen for a DPO, because a queue that is
 * not surfaced is work nobody knows about. Each row links to the thing itself,
 * not to a filtered list — one click, not two.
 */

"use client";

import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { EmptyQueue } from "@/components/ui/graphics";
import { Card, CardHeader, CardTitle, EmptyState } from "@/components/ui/primitives";
import { StatusBadge } from "@/components/ui/status";
import { formatDateTime } from "@/lib/format";

export function QueueCard({
  name,
  items,
}: {
  name: string;
  items: Array<Record<string, unknown>>;
}) {
  return (
    <Card>
      <CardHeader className="flex items-center justify-between">
        <CardTitle>{name}</CardTitle>
        <span className="rounded-full bg-bg-inset px-2.5 py-0.5 text-xs font-medium tabular text-text-muted">
          {items.length}
        </span>
      </CardHeader>

      {items.length === 0 ? (
        <EmptyState
          illustration={<EmptyQueue />}
          title="Nothing waiting"
          description="This queue is clear."
        />
      ) : (
        <ul className="divide-y divide-border">
          {items.map((item, index) => {
            const uuid =
              (item.project_uuid as string) ?? (item.collection_uuid as string) ?? null;
            const href = item.project_uuid
              ? `/projects/${item.project_uuid}`
              : item.collection_uuid
                ? `/collections/${item.collection_uuid}`
                : null;

            const title =
              (item.project_name as string) ??
              (item.source_collection_ref as string) ??
              (item.full_name as string) ??
              (item.name as string) ??
              "Item";

            const Row = (
              <div className="group flex items-center justify-between gap-4 px-5 py-3 transition-colors hover:bg-surface-hover">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{title}</p>
                  {typeof item.action === "string" && (
                    <p className="mt-0.5 text-xs text-text-muted">{item.action}</p>
                  )}
                  {typeof item.declared_asset_count === "number" && (
                    <p className="mt-0.5 text-xs text-warning-text">
                      {item.declared_asset_count} declared,{" "}
                      {String(item.mapped_asset_count ?? 0)} mapped —{" "}
                      {Number(item.declared_asset_count) -
                        Number(item.mapped_asset_count ?? 0)}{" "}
                      unaccounted for
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  {typeof item.project_status === "string" && (
                    <StatusBadge kind="project" value={item.project_status} />
                  )}
                  {typeof item.updated_at === "string" && (
                    <span className="hidden text-xs text-text-subtle sm:inline">
                      {formatDateTime(item.updated_at)}
                    </span>
                  )}
                  {href && (
                    <ArrowRight
                      className="size-4 text-text-subtle transition-transform group-hover:translate-x-0.5 group-hover:text-accent"
                      aria-hidden="true"
                    />
                  )}
                </div>
              </div>
            );

            return (
              <li key={uuid ?? index}>{href ? <Link href={href}>{Row}</Link> : Row}</li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
