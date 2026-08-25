/**
 * Collections, with their reconciliation gap.
 *
 * `unaccounted` is declared minus mapped, and it is the whole point of this
 * screen. The failure mode that matters is not a rejected import - that is loud
 * and gets fixed. It is 500 assets declared and 480 mapped, with 20 sitting in
 * an unlawful state that nobody has looked at.
 *
 * A non-zero gap is therefore rendered as a warning in the row itself, rather
 * than requiring somebody to open each collection to discover it.
 */
"use client";

import {
  AlertTriangle,
} from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { PageHeader } from "@/components/app-shell";
import { ResourceList, useCursorStack } from "@/components/resource-list";
import { EmptyRecords } from "@/components/ui/graphics";
import { Alert, Td, Tr } from "@/components/ui/primitives";
import { useAllCollections } from "@/lib/queries";
import type { CollectionListRow } from "@/lib/types";
import { formatDate } from "@/lib/utils";

export default function CollectionsPage() {
  const stack = useCursorStack();
  const query = useAllCollections({ cursor: stack.cursor, limit: 25 });

  const withGaps = (query.data?.items ?? []).filter((c) => c.unaccounted > 0);

  return (
    <>
      <PageHeader
        title="Collections"
        description="What was actually collected, per source. The declared count comes from the manifest; the mapped count is what the platform can account for."
      />

      {withGaps.length > 0 && (
        <Alert tone="warning" title="Unaccounted assets on this page" className="mb-4">
          <p>
            {withGaps.length} collection(s) declare more assets than the platform has
            mapped to a subject. Those assets are held without a recorded lawful
            basis until the gap is reconciled.
          </p>
        </Alert>
      )}

      <ResourceList<CollectionListRow>
        query={query}
        stack={stack}
        caption="Collections across all projects in scope"
        columns={["Reference", "Project", "Source", "Collected", "Declared", "Mapped"]}
        keyOf={(c) => c.collection_uuid}
        empty={{
          illustration: <EmptyRecords />,
          title: "No collections yet",
          description:
            "A collection appears when a manifest is imported, or when an R&D user records a direct collection.",
        }}
        row={(c) => (
          <Tr className={c.unaccounted > 0 ? "bg-warning-subtle/40" : undefined}>
            <Td>
              <Link
                href={`/collections/${c.collection_uuid}`}
                className="font-mono text-xs font-medium text-accent-text hover:underline"
              >
                {c.source_collection_ref}
              </Link>
              {c.site_label && (
                <p className="mt-0.5 text-xs text-text-subtle">{c.site_label}</p>
              )}
            </Td>
            <Td>
              <Link
                href={`/projects/${c.project_uuid}`}
                className="text-text-muted hover:text-text hover:underline"
              >
                {c.project_name}
              </Link>
            </Td>
            <Td className="text-text-muted">{c.source_name}</Td>
            <Td className="whitespace-nowrap text-text-muted">
              {formatDate(c.collected_on)}
            </Td>
            <Td className="tabular text-text-muted">{c.declared_asset_count}</Td>
            <Td>
              <span className="tabular text-text-muted">{c.mapped_asset_count}</span>
              {c.unaccounted > 0 && (
                <span className="ml-2 inline-flex items-center gap-1 text-xs font-medium text-warning-text">
                  <AlertTriangle className="size-3" aria-hidden="true" />
                  {c.unaccounted} unaccounted
                </span>
              )}
            </Td>
          </Tr>
        )}
      />
    </>
  );
}
