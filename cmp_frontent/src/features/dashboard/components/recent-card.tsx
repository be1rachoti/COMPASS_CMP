/**
 * What has happened lately.
 *
 * The panel is now a thin wrapper around `ActivityFeed`, which is the same
 * renderer the DPO's audit trail uses. That is the whole change: this card used
 * to guess at a label from whichever columns the endpoint happened to return,
 * because the endpoint returned project rows for one role and export rows for
 * another. It could say *that* something changed and never what, or by whom.
 *
 * The server now sends audit entries to every role, so there is nothing left to
 * guess and nothing here that could disagree with the trail.
 */
"use client";

import Link from "next/link";

import { ActivityFeed } from "@/components/data-display/activity-feed";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/primitives";
import type { AuditEntry } from "@/types";

export function RecentCard({
  items,
  isLoading,
  /** Shown for roles that have an audit page to go on to. A DCO and an R&D
   *  User do not, so they get the feed without a dead end. */
  seeAllHref,
}: {
  items: AuditEntry[];
  isLoading?: boolean;
  seeAllHref?: string;
}) {
  return (
    <Card>
      <CardHeader className="flex items-center justify-between gap-3">
        <CardTitle>Recent activity</CardTitle>
        {seeAllHref && (
          <Link
            href={seeAllHref}
            className="text-xs text-accent-text underline-offset-4 hover:underline"
          >
            Full audit trail
          </Link>
        )}
      </CardHeader>
      <CardBody>
        <ActivityFeed
          entries={items}
          isLoading={isLoading}
          emptyTitle="Nothing recorded yet"
          emptyDescription="Activity appears here as soon as anything happens on your projects."
        />
      </CardBody>
    </Card>
  );
}
