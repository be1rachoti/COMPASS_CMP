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

import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  FileText,
  FolderKanban,
  Languages,
  Link2,
  ScrollText,
  Share2,
  ShieldAlert,
  Upload,
} from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { PageHeader } from "@/components/app-shell";
import { BarList, StackedBar, StatTile, type Segment } from "@/components/ui/charts";
import { EmptyQueue, EmptyRecords } from "@/components/ui/graphics";
import {
  Alert,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  EmptyState,
  Skeleton,
} from "@/components/ui/primitives";
import { StatusBadge } from "@/components/ui/status";
import { useDashboard } from "@/features/dashboard";
import { formatDateTime, humanise } from "@/lib/format";
import { useAuth } from "@/providers";

/** Counts worth surfacing, and what they mean. Anything not listed is rendered
 *  with a humanised key - a new backend count appears rather than disappearing. */
const COUNT_LABELS: Record<string, string> = {
  in_draft: "In draft",
  under_process: "Under process",
  pending_approval: "Pending approval",
  approved: "Approved",
  closed: "Closed",
  total: "Total projects",
  draft_notices: "Draft notices",
  draft_purposes: "Draft purposes",
  total_consents: "Consent records",
  withdrawals: "Withdrawals",
  unapproved_languages: "Unapproved translations",
  access_denials_7d: "Access denials (7d)",
  approved_projects: "Approved projects",
  active_links: "Active links",
  consents: "Consents",
  exports: "Exports",
  flagged_assets: "Assets with unmapped subjects",
  times_shared: "Times shared",
  active: "Active consents",
  withdrawn: "Withdrawn",
  declined: "Declined",
};

/**
 * Where the rows behind each figure live.
 *
 * A dashboard number that cannot be clicked is a dead end: the reader's next
 * question is always "which ones", and making them find the list by hand is the
 * difference between a dashboard and a poster.
 *
 * Keys that mean different things to different roles resolve at render time —
 * "consents" is the staff register for staff and her own record for a data
 * subject.
 */
const COUNT_LINKS: Record<string, string> = {
  total: "/projects",
  in_draft: "/projects?status=in_draft",
  under_process: "/projects?status=under_process",
  pending_approval: "/projects?status=pending_approval",
  approved: "/projects?status=approved",
  closed: "/projects?status=closed",
  approved_projects: "/projects?status=approved",

  draft_notices: "/notices?status=draft",
  unapproved_languages: "/notices",
  draft_purposes: "/purposes?status=draft",

  total_consents: "/consents",
  withdrawals: "/consents?status=withdrawn",
  active_links: "/links?status=active",

  exports: "/exports",
  flagged_assets: "/collections",
  access_denials_7d: "/audit",
};

/** The data subject's own figures point at her own records, not the register. */
const SUBJECT_LINKS: Record<string, string> = {
  active: "/my-consents",
  withdrawn: "/my-consents",
  declined: "/my-consents",
  consents: "/my-consents",
  times_shared: "/my-consents",
};

/** Counts that are a problem when non-zero, rather than a neutral statistic. */
const WARNING_COUNTS = new Set([
  "flagged_assets",
  "unapproved_languages",
  "access_denials_7d",
]);

const COUNT_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  total: FolderKanban,
  approved_projects: CheckCircle2,
  draft_notices: ScrollText,
  draft_purposes: FileText,
  active_links: Link2,
  consents: FileText,
  total_consents: FileText,
  exports: Upload,
  times_shared: Share2,
  flagged_assets: AlertTriangle,
  unapproved_languages: Languages,
  access_denials_7d: ShieldAlert,
};

/** The project state machine, in the order it is walked. */
const LIFECYCLE = ["in_draft", "under_process", "pending_approval", "approved", "closed"] as const;

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

/**
 * Build the part-to-whole view of consent, from whichever counts this role got.
 *
 * Returns the keys it consumed so the caller can avoid printing the same number
 * twice. Returns null when the response does not carry enough to make an honest
 * whole — a composition chart missing a slice is worse than no chart.
 */
function consentComposition(
  counts: Record<string, number>,
): { segments: Segment[]; consumed: string[] } | null {
  // The data subject's own record: explicit states, nothing to derive.
  if ("active" in counts && ("withdrawn" in counts || "declined" in counts)) {
    return {
      segments: [
        { key: "active", label: "Active", value: counts.active ?? 0, color: "var(--viz-1)" },
        { key: "withdrawn", label: "Withdrawn", value: counts.withdrawn ?? 0, color: "var(--viz-3)" },
        // Declined is grey rather than red: it is a valid answer, not a fault.
        { key: "declined", label: "Declined", value: counts.declined ?? 0, color: "var(--viz-neutral)" },
      ],
      consumed: ["active", "withdrawn", "declined"],
    };
  }

  // Staff view: the register reports a total and the withdrawals within it.
  if ("total_consents" in counts && "withdrawals" in counts) {
    const withdrawn = counts.withdrawals ?? 0;
    const standing = Math.max(0, (counts.total_consents ?? 0) - withdrawn);
    return {
      segments: [
        { key: "standing", label: "Still standing", value: standing, color: "var(--viz-1)" },
        { key: "withdrawn", label: "Withdrawn", value: withdrawn, color: "var(--viz-3)" },
      ],
      consumed: ["total_consents", "withdrawals"],
    };
  }

  return null;
}

function roleBlurb(role: string | null | undefined): string {
  switch (role) {
    case "dpo":
      return "Notices awaiting publication, projects awaiting your review, and the consent position across the platform.";
    case "dco":
      return "Your approved projects, the links collecting against them, and anything that failed to reconcile on import.";
    case "rnd_user":
      return "Your projects and what each one needs from you before it can move forward.";
    case "admin":
      return "Accounts, lockouts, and the state of the processor and source registry.";
    default:
      return "Your consents and what has happened to your data.";
  }
}

function QueueCard({
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

function RecentCard({ items }: { items: Array<Record<string, unknown>> }) {
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

function DashboardSkeleton() {
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
