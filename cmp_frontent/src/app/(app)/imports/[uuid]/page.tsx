/**
 * Import batch detail.
 *
 * The status worth looking at is **partial**: some rows landed and some did not,
 * which is the only outcome that leaves the dataset in a state nobody chose.
 * Accepted and rejected are both unambiguous; partial needs a person, so the
 * error report is on the page rather than behind a download.
 *
 * The file hash is shown because imports are idempotent — rows upsert on
 * (source, source_reference) — and the hash is how somebody checks whether the
 * file they are about to re-send is the one already accounted for.
 */
"use client";

import { AlertTriangle, ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import * as React from "react";

import { PageHeader } from "@/components/layout/app-shell";
import { StackedBar, StatTile, type Segment } from "@/components/ui/charts";
import { EmptyQueue } from "@/components/ui/graphics";
import {
  Alert,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  DescriptionItem,
  DescriptionList,
  EmptyState,
  Mono,
  Skeleton,
  Table,
  Td,
  Th,
  Tr,
} from "@/components/ui/primitives";
import { StatusBadge } from "@/components/ui/status";
import { useImportBatch, useImportErrors } from "@/features/exchange";
import { formatDateTime, shortHash } from "@/lib/format";

export default function ImportDetailPage() {
  const { uuid } = useParams<{ uuid: string }>();

  const batch = useImportBatch(uuid);
  // Only fetched when there is something to report; a clean batch has no rows
  // to look at and the call would be a round trip for an empty array.
  const wantErrors = (batch.data?.rejected_rows ?? 0) > 0;
  const errors = useImportErrors(wantErrors ? uuid : undefined);

  if (batch.error) {
    return (
      <>
        <PageHeader title="Import batch" breadcrumb={<BackLink />} />
        <Alert tone="danger" title="Could not load this batch">
          {batch.error.isForbidden
            ? "Your role does not permit this. The attempt has been recorded in the audit trail."
            : batch.error.userMessage()}
        </Alert>
      </>
    );
  }

  if (batch.isLoading || !batch.data) {
    return (
      <>
        <PageHeader title="Import batch" breadcrumb={<BackLink />} />
        <Skeleton className="h-80" />
      </>
    );
  }

  const record = batch.data;
  const unprocessed = Math.max(
    0,
    record.declared_rows - record.accepted_rows - record.rejected_rows,
  );

  const outcome: Segment[] = [
    { key: "accepted", label: "Accepted", value: record.accepted_rows, color: "var(--viz-1)" },
    { key: "rejected", label: "Rejected", value: record.rejected_rows, color: "var(--viz-3)" },
    { key: "unprocessed", label: "Not processed", value: unprocessed, color: "var(--viz-neutral)" },
  ];

  return (
    <>
      <PageHeader
        eyebrow="Import"
        title={record.file_name}
        description={`${record.source_name} · received ${formatDateTime(record.received_at)}`}
        breadcrumb={<BackLink />}
        actions={<StatusBadge kind="batch" value={record.status} />}
      />

      {record.status === "partial" && (
        <Alert tone="warning" title="This batch landed partially" className="mb-4">
          {record.accepted_rows} of {record.declared_rows} rows were accepted. The
          rest are listed below with the reason each was refused. Fix them and
          re-send the file — the import is idempotent, so the rows already
          accepted will not duplicate.
        </Alert>
      )}

      <div className="stagger mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Declared" value={record.declared_rows} />
        <StatTile label="Accepted" value={record.accepted_rows} />
        <StatTile
          label="Rejected"
          value={record.rejected_rows}
          tone={record.rejected_rows > 0 ? "attention" : "neutral"}
          icon={record.rejected_rows > 0 ? <AlertTriangle /> : undefined}
        />
        <StatTile label="Not processed" value={unprocessed} />
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Outcome</CardTitle>
            </CardHeader>
            <CardBody>
              <StackedBar
                segments={outcome}
                total={record.declared_rows}
                caption="Every declared row, counted once at its outcome."
              />
            </CardBody>
          </Card>

          <Card>
            <CardHeader className="flex items-center justify-between">
              <CardTitle>Rejected rows</CardTitle>
              {wantErrors && (
                <span className="rounded-full bg-warning-subtle px-2.5 py-0.5 text-xs font-medium tabular text-warning-text">
                  {record.rejected_rows}
                </span>
              )}
            </CardHeader>

            {!wantErrors ? (
              <EmptyState
                illustration={<EmptyQueue />}
                title="Nothing was rejected"
                description="Every declared row was accepted."
              />
            ) : errors.isLoading ? (
              <CardBody>
                <Skeleton className="h-32" />
              </CardBody>
            ) : errors.error ? (
              <CardBody>
                <Alert tone="danger">{errors.error.userMessage()}</Alert>
              </CardBody>
            ) : (errors.data?.errors ?? []).length === 0 ? (
              <CardBody>
                <Alert tone="info">
                  {record.rejected_rows} rows were refused but the report is no
                  longer stored. Re-run the validation to see the reasons.
                </Alert>
              </CardBody>
            ) : (
              <Table>
                <caption className="sr-only">Rejected rows in {record.file_name}</caption>
                <thead>
                  <tr>
                    <Th className="w-20">Row</Th>
                    <Th className="w-40">Field</Th>
                    <Th>Reason</Th>
                  </tr>
                </thead>
                <tbody>
                  {(errors.data?.errors ?? []).map((error, index) => (
                    <Tr key={index}>
                      <Td className="tabular text-text-muted">{error.row ?? "—"}</Td>
                      <Td>
                        {error.field ? (
                          <Mono className="text-text">{error.field}</Mono>
                        ) : (
                          <span className="text-text-subtle">—</span>
                        )}
                      </Td>
                      <Td className="text-text-muted">
                        {error.error ?? JSON.stringify(error)}
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>The file</CardTitle>
            </CardHeader>
            <CardBody className="space-y-4">
              <DescriptionList>
                <DescriptionItem term="Name">{record.file_name}</DescriptionItem>
                <DescriptionItem term="SHA-256">
                  <Mono title={record.file_hash}>{shortHash(record.file_hash)}</Mono>
                </DescriptionItem>
                <DescriptionItem term="Source">
                  {record.source_name}
                  <span className="ml-1.5 text-text-subtle">{record.source_code}</span>
                </DescriptionItem>
                <DescriptionItem term="Project">
                  {record.project_uuid ? (
                    <Link
                      href={`/projects/${record.project_uuid}`}
                      className="text-accent-text underline underline-offset-2"
                    >
                      {record.project_name}
                    </Link>
                  ) : (
                    "—"
                  )}
                </DescriptionItem>
                <DescriptionItem term="Imported by">
                  {record.imported_by_name}
                </DescriptionItem>
                <DescriptionItem term="Received">
                  {formatDateTime(record.received_at)}
                </DescriptionItem>
              </DescriptionList>

              <p className="rounded-lg bg-bg-subtle p-3 text-xs leading-relaxed text-text-muted">
                Imports upsert on (source, source reference), so re-sending this
                file accepts nothing new and reports zero rather than duplicating
                a collection.
              </p>
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}

function BackLink() {
  return (
    <Link href="/imports" className="inline-flex items-center gap-1.5 hover:text-text">
      <ArrowLeft className="size-3.5" aria-hidden="true" />
      All imports
    </Link>
  );
}
