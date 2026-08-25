/**
 * Notifications.
 *
 * Derived from the audit trail rather than stored in a table of their own. There
 * is no notifications table among the 22, and deriving the feed means it can
 * never disagree with the record it is describing - a notification claiming
 * something happened that the audit trail does not show would be worse than no
 * notification at all.
 */
"use client";

import { ChevronRight } from "lucide-react";
import * as React from "react";

import { PageHeader } from "@/components/layout/app-shell";
import { AuditDetailDialog, EntityRef, eventSentence } from "@/components/data-display/audit-detail";
import { EmptyQueue } from "@/components/ui/graphics";
import {
  Alert,
  Card,
  CardBody,
  EmptyState,
  Skeleton,
} from "@/components/ui/primitives";
import { useNotifications } from "@/features/notifications";
import type { AuditEntry } from "@/types";
import { formatDateTime, formatRelative, humanise } from "@/lib/format";

export default function NotificationsPage() {
  const query = useNotifications();
  const [open, setOpen] = React.useState<AuditEntry | null>(null);

  const items = query.data?.items ?? [];

  return (
    <>
      <PageHeader
        title="Notifications"
        description="What has happened that concerns you, taken from the audit trail itself."
      />

      {query.error && (
        <Alert tone="danger" title="Could not load notifications">
          {query.error.userMessage()}
        </Alert>
      )}

      {query.isLoading && (
        <Card>
          <CardBody className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-12" />
            ))}
          </CardBody>
        </Card>
      )}

      {query.data && items.length === 0 && (
        <Card>
          <EmptyState
            illustration={<EmptyQueue />}
            title="Nothing to report"
            description="Events that concern you will appear here as they happen."
          />
        </Card>
      )}

      {items.length > 0 && (
        <Card>
          <ul className="divide-y divide-border">
            {items.map((item) => (
              <li key={item.log_uuid}>
                {/* Each entry opens the same detail view the audit trail uses.
                    "Notice published" with no way to see *which* notice, or what
                    was recorded about it, is a bell without a message. */}
                <button
                  type="button"
                  onClick={() => setOpen(item)}
                  className="group w-full px-5 py-3.5 text-left transition-colors hover:bg-surface-hover"
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="text-sm font-medium">
                      {humanise(item.event_type.replace(/\./g, " "))}
                    </p>
                    <span
                      className="text-xs text-text-subtle"
                      title={formatDateTime(item.occurred_at)}
                    >
                      {formatRelative(item.occurred_at)}
                    </span>
                  </div>

                  {eventSentence(item) !== humanise(item.event_type.replace(/\./g, " ")) && (
                    <p className="mt-1 text-sm leading-relaxed text-text-muted">
                      {eventSentence(item)}
                    </p>
                  )}

                  <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                    <EntityRef entry={item} />
                    {item.actor_name && (
                      <span className="text-text-subtle">by {item.actor_name}</span>
                    )}
                    <span className="ml-auto inline-flex items-center gap-1 text-accent-text opacity-0 transition-opacity group-hover:opacity-100">
                      Details
                      <ChevronRight className="size-3.5" aria-hidden="true" />
                    </span>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <AuditDetailDialog entry={open} onClose={() => setOpen(null)} />
    </>
  );
}
