/**
 * The dashboard.
 *
 * One endpoint, role-aware. The response shape differs by role but the call does
 * not, so there is one loading path here rather than five components each
 * fetching something different.
 *
 * The work queues matter more than the counts. A DPO opening this page needs to
 * know what is waiting for *her*, not how many projects exist — so the queues
 * sit above the fold and the figures support them.
 *
 * On the charts: a count that a chart already explains is not repeated as a
 * tile. The project lifecycle is a magnitude comparison across named stages, so
 * it is a one-hue bar list; the consent position is part-to-whole, so it is a
 * single direct-labelled stacked bar. Nothing here is a pie, and nothing is a
 * one-bar bar chart pretending a number needs a plot.
 */
"use client";

import * as React from "react";

import { PageHeader } from "@/components/layout/app-shell";
import { BarList, StackedBar, StatTile } from "@/components/ui/charts";

import { Alert, Card, CardBody, CardHeader, CardTitle } from "@/components/ui/primitives";

import { useDashboard } from "@/features/dashboard";
import {
  COUNT_ICONS,
  COUNT_LABELS,
  COUNT_LINKS,
  DashboardSkeleton,
  LIFECYCLE,
  QueueCard,
  RecentCard,
  SUBJECT_LINKS,
  WARNING_COUNTS,
  consentComposition,
  roleBlurb,
} from "@/features/dashboard/components";
import { humanise } from "@/lib/format";
import { useAuth } from "@/providers";

export default function DashboardPage() {
  const { me } = useAuth();
  const { data, isLoading, error } = useDashboard();

  const isSubject = me?.role === "data_subject";
  const counts = data?.counts ?? {};
  const lifecycle = LIFECYCLE.filter((k) => k in counts).map((k) => ({
    key: k,
    label: COUNT_LABELS[k],
    value: counts[k],
    href: `/projects?status=${k}`,
  }));
  const composition = consentComposition(counts);

  // A figure a chart already explains is not repeated as a tile.
  const charted = new Set<string>([
    ...lifecycle.map((s) => s.key),
    ...(composition?.consumed ?? []),
  ]);
  const tiles = Object.entries(counts).filter(([key]) => !charted.has(key));

  return (
    <>
      <PageHeader
        eyebrow={me ? humanise(me.role) : undefined}
        title={me ? `Good day, ${me.full_name.split(" ")[0]}` : "Dashboard"}
        description={roleBlurb(me?.role)}
      />

      {error && (
        <Alert tone="danger" title="Could not load the dashboard">
          {error.userMessage()}
        </Alert>
      )}

      {isLoading && <DashboardSkeleton />}

      {data && (
        <div className="space-y-6">
          {tiles.length > 0 && (
            <div className="stagger grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {tiles.map(([key, value]) => {
                const alarming = WARNING_COUNTS.has(key) && value > 0;
                const Icon = COUNT_ICONS[key];
                const href = isSubject
                  ? (SUBJECT_LINKS[key] ?? COUNT_LINKS[key])
                  : (COUNT_LINKS[key] ?? (key === "consents" ? "/consents" : undefined));
                return (
                  <StatTile
                    key={key}
                    label={COUNT_LABELS[key] ?? humanise(key)}
                    value={value}
                    tone={alarming ? "attention" : "neutral"}
                    hint={alarming ? "Needs attention" : undefined}
                    icon={Icon ? <Icon /> : undefined}
                    href={href}
                  />
                );
              })}
            </div>
          )}

          {(lifecycle.length > 0 || composition) && (
            <div className="grid gap-4 lg:grid-cols-2">
              {lifecycle.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle>Projects by stage</CardTitle>
                  </CardHeader>
                  <CardBody>
                    <BarList items={lifecycle} emptyLabel="No projects registered yet." />
                    <p className="mt-4 text-xs text-text-subtle">
                      A project moves in one direction through these stages. Only an
                      approved project may collect consent.
                    </p>
                  </CardBody>
                </Card>
              )}

              {composition && (
                <Card>
                  <CardHeader>
                    <CardTitle>Consent position</CardTitle>
                  </CardHeader>
                  <CardBody>
                    <StackedBar
                      segments={composition.segments}
                      caption="Every record counted once, at its current state."
                    />
                  </CardBody>
                </Card>
              )}
            </div>
          )}

          {data.queues.map((queue) => (
            <QueueCard key={queue.name} name={queue.name} items={queue.items} />
          ))}

          {data.recent.length > 0 && <RecentCard items={data.recent} />}
        </div>
      )}
    </>
  );
}

