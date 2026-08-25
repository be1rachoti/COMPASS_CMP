/**
 * The consent register.
 *
 * Staff see consent status and contact details, and no other personal data.
 * Every status here is derived from `v_current_consent` on read - a stored
 * status column would be a second copy of the truth, and the copy goes stale
 * the moment somebody withdraws.
 */
"use client";

import Link from "next/link";
import * as React from "react";

import { PageHeader } from "@/components/app-shell";
import {
  FilterBar,
  FilterSelect,
  ResourceList,
  useCursorStack,
  useFilterParam,
} from "@/components/resource-list";
import { EmptyConsent } from "@/components/ui/graphics";
import { Td, Tr } from "@/components/ui/primitives";
import { StatusBadge } from "@/components/ui/status";
import { useAllConsents } from "@/lib/queries";
import type { ConsentListRow } from "@/lib/types";
import { formatDateTime } from "@/lib/utils";

/** Not from /meta/enums: these are derived states, not a database enum. */
const STATUS_OPTIONS = [
  { value: "consented", label: "Consented" },
  { value: "partial", label: "Partial" },
  { value: "declined", label: "Declined" },
  { value: "withdrawn", label: "Withdrawn" },
];

function ConsentsPageView() {
  const stack = useCursorStack();
  const [status, setStatus] = useFilterParam("status");

  const query = useAllConsents({
    status: status || undefined,
    cursor: stack.cursor,
    limit: 25,
  });

  return (
    <>
      <PageHeader
        title="Consents"
        description="The current position for every data subject in scope. Withdrawal supersedes rather than edits, so this always reflects the latest artefact."
      />

      <FilterBar>
        <FilterSelect
          label="Status"
          value={status}
          onChange={(v) => {
            setStatus(v);
            stack.reset();
          }}
          options={STATUS_OPTIONS}
          allLabel="All statuses"
        />
      </FilterBar>

      <ResourceList<ConsentListRow>
        query={query}
        stack={stack}
        caption="Current consent records across all projects in scope"
        columns={["Data subject", "Project", "Site", "Status", "Purposes", "Recorded"]}
        keyOf={(c) => c.consent_uuid}
        empty={{
          illustration: <EmptyConsent />,
          title: status ? "No consents match" : "No consent records yet",
          description:
            "Records appear once a data subject completes a consent link for an approved project.",
        }}
        row={(c) => (
          <Tr>
            <Td>
              <Link
                href={`/consents/${c.consent_uuid}`}
                className="font-medium text-accent-text hover:underline"
              >
                {c.subject_name}
              </Link>
              <p className="mt-0.5 text-xs text-text-subtle">{c.subject_email}</p>
            </Td>
            <Td>
              <Link
                href={`/projects/${c.project_uuid}`}
                className="text-text-muted hover:text-text hover:underline"
              >
                {c.project_name}
              </Link>
            </Td>
            <Td className="text-text-muted">{c.site_label}</Td>
            <Td>
              <StatusBadge kind="consent" value={c.consent_status} />
            </Td>
            <Td className="tabular text-text-muted">
              {c.granted_count} of {c.granted_count + c.refused_count}
            </Td>
            <Td className="whitespace-nowrap text-text-muted">
              {formatDateTime(c.affirmative_action_at)}
            </Td>
          </Tr>
        )}
      />
    </>
  );
}

/**
 * `useFilterParam` reads the query string, which forces client rendering, so
 * Next requires a suspense boundary around it. Without one the whole route bails
 * out of prerendering.
 */
export default function ConsentsPage() {
  return (
    <React.Suspense fallback={<PageSkeleton />}>
      <ConsentsPageView />
    </React.Suspense>
  );
}

function PageSkeleton() {
  return (
    <div className="space-y-4" aria-hidden="true">
      <div className="shimmer h-8 w-64 rounded-lg" />
      <div className="shimmer h-14 rounded-xl" />
      <div className="shimmer h-72 rounded-xl" />
    </div>
  );
}
