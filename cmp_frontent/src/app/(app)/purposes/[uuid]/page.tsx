/**
 * Purpose detail.
 *
 * A purpose is the unit consent is given against, so this page answers two
 * questions: what exactly was promised, and where is that promise already in
 * force.
 *
 * The usage list is the reason retirement is not a delete. A purpose attached to
 * a published notice cannot be retired, because people have already consented
 * against those words - so the block is shown here, with the notices causing it,
 * before anyone reaches for the button.
 */
"use client";

import { ArrowLeft, Lock } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import * as React from "react";

import { PageHeader } from "@/components/app-shell";
import { EmptyRecords } from "@/components/ui/graphics";
import {
  Alert,
  Badge,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  DescriptionItem,
  DescriptionList,
  EmptyState,
  Skeleton,
  Table,
  Td,
  Th,
  Tr,
} from "@/components/ui/primitives";
import { StatusBadge } from "@/components/ui/status";
import { usePurpose, usePurposeUsage, usePurposeVersions } from "@/lib/queries";
import { formatDateTime, formatDuration, humanise } from "@/lib/utils";

export default function PurposeDetailPage() {
  const { uuid } = useParams<{ uuid: string }>();

  const purpose = usePurpose(uuid);
  const usage = usePurposeUsage(uuid);
  const versions = usePurposeVersions(uuid);

  if (purpose.error) {
    return (
      <>
        <PageHeader title="Purpose" breadcrumb={<BackLink />} />
        <Alert tone="danger" title="Could not load this purpose">
          {purpose.error.isForbidden
            ? "Your role does not permit this. The attempt has been recorded in the audit trail."
            : purpose.error.userMessage()}
        </Alert>
      </>
    );
  }

  if (purpose.isLoading || !purpose.data) {
    return (
      <>
        <PageHeader title="Purpose" breadcrumb={<BackLink />} />
        <Skeleton className="h-80" />
      </>
    );
  }

  const record = purpose.data;
  const usageItems = usage.data?.items ?? [];
  const retirable = usage.data?.retirable ?? null;

  return (
    <>
      <PageHeader
        eyebrow="Purpose"
        title={record.name}
        description={record.purpose_code}
        breadcrumb={<BackLink />}
        actions={<StatusBadge kind="purpose" value={record.status} />}
      />

      {retirable === false && (
        <Alert tone="info" className="mb-4">
          <p className="flex items-start gap-2 leading-relaxed">
            <Lock className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>
              This purpose is attached to a published notice, so it cannot be
              retired. People have already consented against these words; retiring
              it would leave their consent pointing at nothing.
            </span>
          </p>
        </Alert>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>What was promised</CardTitle>
            </CardHeader>
            <CardBody className="space-y-4">
              <section>
                <h3 className="text-2xs font-semibold uppercase tracking-wider text-text-subtle">
                  Description
                </h3>
                <p className="mt-1 text-sm leading-relaxed text-text-muted">
                  {record.description}
                </p>
              </section>
              <section>
                <h3 className="text-2xs font-semibold uppercase tracking-wider text-text-subtle">
                  Uses
                </h3>
                <p className="mt-1 text-sm leading-relaxed text-text-muted">
                  {record.uses}
                </p>
              </section>
              <section>
                <h3 className="text-2xs font-semibold uppercase tracking-wider text-text-subtle">
                  Data categories
                </h3>
                <ul className="mt-1.5 flex flex-wrap gap-1.5">
                  {record.data_categories.map((category) => (
                    <li key={category}>
                      <Badge tone="neutral">{humanise(category)}</Badge>
                    </li>
                  ))}
                </ul>
              </section>
            </CardBody>
          </Card>

          <Card>
            <CardHeader className="flex items-center justify-between">
              <CardTitle>Notices using this purpose</CardTitle>
              <span className="rounded-full bg-bg-inset px-2.5 py-0.5 text-xs font-medium tabular text-text-muted">
                {usage.data?.total ?? 0}
              </span>
            </CardHeader>

            {usage.isLoading ? (
              <CardBody>
                <Skeleton className="h-24" />
              </CardBody>
            ) : usage.error ? (
              <CardBody>
                <Alert tone={usage.error.isForbidden ? "info" : "danger"}>
                  {usage.error.isForbidden
                    ? "Your role does not permit the usage lookup."
                    : usage.error.userMessage()}
                </Alert>
              </CardBody>
            ) : usageItems.length === 0 ? (
              <EmptyState
                illustration={<EmptyRecords />}
                title="Not attached to any notice"
                description="Nobody has been asked to consent to this purpose yet."
              />
            ) : (
              <Table>
                <caption className="sr-only">Notices using {record.name}</caption>
                <thead>
                  <tr>
                    <Th>Notice</Th>
                    <Th>Project</Th>
                    <Th>Status</Th>
                    <Th>Required</Th>
                    <Th>Published</Th>
                  </tr>
                </thead>
                <tbody>
                  {usageItems.map((item) => (
                    <Tr key={item.notice_uuid}>
                      <Td>
                        <Link
                          href={`/notices/${item.notice_uuid}`}
                          className="font-medium text-accent-text hover:underline"
                        >
                          {item.notice_code}
                        </Link>
                        <p className="text-xs text-text-subtle">version {item.version}</p>
                      </Td>
                      <Td>{item.project_name}</Td>
                      <Td>
                        <StatusBadge kind="notice" value={item.status} />
                      </Td>
                      <Td>
                        {item.is_mandatory ? (
                          <Badge tone="warning">Mandatory</Badge>
                        ) : (
                          <span className="text-text-subtle">Optional</span>
                        )}
                      </Td>
                      <Td className="whitespace-nowrap text-text-muted">
                        {item.published_at ? formatDateTime(item.published_at) : "—"}
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
              <CardTitle>Terms</CardTitle>
            </CardHeader>
            <CardBody>
              <DescriptionList>
                <DescriptionItem term="Code">{record.purpose_code}</DescriptionItem>
                <DescriptionItem term="Version">{record.version}</DescriptionItem>
                <DescriptionItem term="Lawful basis">
                  {humanise(record.lawful_basis)}
                </DescriptionItem>
                <DescriptionItem term="Retention">
                  {formatDuration(record.retention_period)}
                </DescriptionItem>
                <DescriptionItem term="Created">
                  {formatDateTime(record.created_at)}
                </DescriptionItem>
              </DescriptionList>
            </CardBody>
          </Card>

          {/* Versions are DPO/admin only. A 403 hides the card rather than
              showing an error nobody can act on. */}
          {!versions.error && (versions.data?.length ?? 0) > 1 && (
            <Card>
              <CardHeader>
                <CardTitle>Version history</CardTitle>
              </CardHeader>
              <CardBody>
                <ul className="space-y-2.5">
                  {versions.data?.map((version) => (
                    <li
                      key={version.purpose_uuid}
                      className="flex items-center justify-between gap-3 text-sm"
                    >
                      <span className="text-text-muted">
                        Version {version.version}
                        {version.purpose_uuid === record.purpose_uuid && (
                          <span className="ml-1.5 text-xs text-accent-text">current</span>
                        )}
                      </span>
                      <StatusBadge kind="purpose" value={version.status} dot={false} />
                    </li>
                  ))}
                </ul>
              </CardBody>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}

function BackLink() {
  return (
    <Link href="/purposes" className="inline-flex items-center gap-1.5 hover:text-text">
      <ArrowLeft className="size-3.5" aria-hidden="true" />
      All purposes
    </Link>
  );
}
