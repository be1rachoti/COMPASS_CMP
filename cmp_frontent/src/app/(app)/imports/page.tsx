/**
 * Import batches.
 *
 * The status worth looking at is **partial**: some rows landed and some did not,
 * which is the only outcome that leaves the dataset in a state nobody chose.
 * Accepted and rejected are both unambiguous; partial needs a person.
 *
 * Imports are idempotent - rows upsert on (source, source_reference) - so
 * re-submitting the same file accepts nothing and reports zero rather than
 * duplicating a collection.
 */
"use client";

import { AlertTriangle, Upload } from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { PageHeader } from "@/components/app-shell";
import {
  FilterBar,
  FilterSelect,
  ResourceList,
  useCursorStack,
} from "@/components/resource-list";
import { ImportForm } from "@/components/forms/exchange-forms";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { EmptyRecords } from "@/components/ui/graphics";
import { Alert, Button, Td, Tr } from "@/components/ui/primitives";
import { StatusBadge } from "@/components/ui/status";
import { useImports } from "@/features/exchange";
import { useEnums } from "@/features/meta";
import type { ImportBatch } from "@/types";
import { formatDateTime } from "@/lib/format";

export default function ImportsPage() {
  const stack = useCursorStack();
  const [status, setStatus] = React.useState("");
  const [importing, setImporting] = React.useState(false);

  const { data: enums } = useEnums();
  const query = useImports({
    status: status || undefined,
    cursor: stack.cursor,
    limit: 25,
  });

  const partial = (query.data?.items ?? []).filter((b) => b.status === "partial");

  return (
    <>
      <PageHeader
        title="Imports"
        description="Manifests received from labs and tools. Validate first - it is a dry run that writes nothing - because a third-party manifest is the input you trust least."
        actions={
          <Button variant="primary" onClick={() => setImporting(true)}>
            <Upload className="size-4" />
            Import a manifest
          </Button>
        }
      />

      {partial.length > 0 && (
        <Alert tone="warning" title="Partially accepted batches" className="mb-4">
          <p>
            {partial.length} batch(es) accepted some rows and rejected others. Open
            each one to see which rows failed and why, then re-submit a corrected
            manifest — the import is idempotent, so the accepted rows will not
            duplicate.
          </p>
        </Alert>
      )}

      <FilterBar>
        <FilterSelect
          label="Status"
          value={status}
          onChange={(v) => {
            setStatus(v);
            stack.reset();
          }}
          options={enums?.batch_status ?? []}
          allLabel="All statuses"
        />
      </FilterBar>

      <ResourceList<ImportBatch>
        query={query}
        stack={stack}
        caption="Import batches in scope"
        columns={["File", "Source", "Project", "Status", "Rows", "Received"]}
        keyOf={(b) => b.batch_uuid}
        empty={{
          illustration: <EmptyRecords />,
          title: status ? "No batches match" : "Nothing imported yet",
          description:
            "Validate a manifest first; only submit it for real once the dry run comes back clean.",
        }}
        row={(b) => (
          <Tr className={b.status === "partial" ? "bg-warning-subtle/40" : undefined}>
            <Td>
              <Link
                href={`/imports/${b.batch_uuid}`}
                className="font-medium text-accent-text hover:underline"
              >
                {b.file_name}
              </Link>
            </Td>
            <Td>
              <span className="font-mono text-xs text-text-muted">{b.source_code}</span>
            </Td>
            <Td>
              {b.project_uuid ? (
                <Link
                  href={`/projects/${b.project_uuid}`}
                  className="text-text-muted hover:text-text hover:underline"
                >
                  {b.project_name}
                </Link>
              ) : (
                <span className="text-xs text-text-subtle">—</span>
              )}
            </Td>
            <Td>
              <StatusBadge kind="batch" value={b.status} />
            </Td>
            <Td className="tabular text-text-muted">
              {b.accepted_rows} of {b.declared_rows}
              {b.rejected_rows > 0 && (
                <span className="ml-2 inline-flex items-center gap-1 text-xs text-danger-text">
                  <AlertTriangle className="size-3" aria-hidden="true" />
                  {b.rejected_rows} rejected
                </span>
              )}
            </Td>
            <Td className="whitespace-nowrap text-text-muted">
              {formatDateTime(b.received_at)}
            </Td>
          </Tr>
        )}
      />

      <Dialog open={importing} onOpenChange={setImporting}>
        <DialogContent
          title="Import a manifest"
          description="Validate first. The dry run parses and checks everything without writing a row."
          size="lg"
        >
          <ImportForm onDone={() => setImporting(false)} />
        </DialogContent>
      </Dialog>
    </>
  );
}
