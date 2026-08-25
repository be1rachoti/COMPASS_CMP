/**
 * Collection sites.
 *
 * A site is not an internal detail: it becomes a *recipient* named in the
 * published notice, generated from this list at publication. So this page is
 * also the answer to "where does our data actually go", and adding a site to a
 * project whose notice is already published is a material change requiring a new
 * notice version.
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
} from "@/components/resource-list";
import { EmptyRecords } from "@/components/ui/graphics";
import { Alert, Td, Tr } from "@/components/ui/primitives";
import { StatusBadge } from "@/components/ui/status";
import { useEnums } from "@/features/meta";
import { useAllSites } from "@/features/projects";
import type { SiteListRow } from "@/types";
import { formatDate } from "@/lib/format";

export default function SitesPage() {
  const stack = useCursorStack();
  const [status, setStatus] = React.useState("");

  const { data: enums } = useEnums();
  const query = useAllSites({
    status: status || undefined,
    cursor: stack.cursor,
    limit: 25,
  });

  return (
    <>
      <PageHeader
        title="Collection sites"
        description="Where collection happens, and who operates it. Active sites become the recipient list printed in the notice."
      />

      <Alert tone="info" className="mb-4">
        Adding a site to a project whose notice is already published is a material
        change: it adds a recipient the published text does not name, so it
        requires a new notice version before collection starts there.
      </Alert>

      <FilterBar>
        <FilterSelect
          label="Status"
          value={status}
          onChange={(v) => {
            setStatus(v);
            stack.reset();
          }}
          options={enums?.record_status ?? []}
          allLabel="All statuses"
        />
      </FilterBar>

      <ResourceList<SiteListRow>
        query={query}
        stack={stack}
        caption="Collection sites across all projects in scope"
        columns={["Site", "Project", "Operated by", "Active links", "Status", "Created"]}
        keyOf={(s) => s.site_uuid}
        empty={{
          illustration: <EmptyRecords />,
          title: status ? "No sites match" : "No sites yet",
          description:
            "A project needs at least one active site before its notice can state who receives the data.",
        }}
        row={(s) => (
          <Tr>
            <Td>
              <span className="font-medium">{s.site_label}</span>
              {s.location && (
                <p className="mt-0.5 text-xs text-text-subtle">{s.location}</p>
              )}
            </Td>
            <Td>
              <Link
                href={`/projects/${s.project_uuid}`}
                className="text-text-muted hover:text-text hover:underline"
              >
                {s.project_name}
              </Link>
              <div className="mt-0.5">
                <StatusBadge kind="project" value={s.project_status} dot={false} />
              </div>
            </Td>
            <Td className="text-text-muted">
              {s.processor_name ?? (
                <span className="text-xs text-text-subtle">operated internally</span>
              )}
            </Td>
            <Td className="tabular text-text-muted">{s.active_links}</Td>
            <Td>
              <StatusBadge kind="record" value={s.status} />
            </Td>
            <Td className="whitespace-nowrap text-text-muted">{formatDate(s.created_at)}</Td>
          </Tr>
        )}
      />
    </>
  );
}
