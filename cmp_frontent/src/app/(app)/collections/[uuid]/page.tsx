/**
 * Collection detail.
 *
 * The number that matters on this page is **unaccounted**: declared minus
 * mapped. A rejected import is obvious and gets fixed. The dangerous outcome is
 * 500 assets declared, 480 mapped, and 20 sitting in an unlawful state that
 * nobody is looking at — so the reconciliation is the first thing on the screen,
 * not a statistic buried under a table.
 *
 * `has_unmapped_subjects` on an asset is the second half of the same control:
 * the asset arrived, but somebody in it has no consent behind them.
 */
"use client";

import { AlertTriangle, ArrowLeft, CheckCircle2 } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import * as React from "react";

import { PageHeader } from "@/components/app-shell";
import { Meter, StatTile } from "@/components/ui/charts";
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
  Mono,
  Skeleton,
  Table,
  Td,
  Th,
  Tr,
} from "@/components/ui/primitives";
import {
  useCollection,
  useCollectionAssets,
  useCollectionExceptions,
} from "@/features/exchange";
import { formatDate, formatDateTime, humanise } from "@/lib/format";

export default function CollectionDetailPage() {
  const { uuid } = useParams<{ uuid: string }>();

  const collection = useCollection(uuid);
  const assets = useCollectionAssets(uuid);
  const exceptions = useCollectionExceptions(uuid);

  if (collection.error) {
    return (
      <>
        <PageHeader title="Collection" breadcrumb={<BackLink />} />
        <Alert tone="danger" title="Could not load this collection">
          {collection.error.isForbidden
            ? "Your role does not permit this. The attempt has been recorded in the audit trail."
            : collection.error.userMessage()}
        </Alert>
      </>
    );
  }

  if (collection.isLoading || !collection.data) {
    return (
      <>
        <PageHeader title="Collection" breadcrumb={<BackLink />} />
        <Skeleton className="h-80" />
      </>
    );
  }

  const record = collection.data;

  // `declared_asset_count` is an optional manifest column. Zero means the source
  // asserted nothing, which is not the same as asserting zero - and calling that
  // "reconciled" would be the reconciliation control quietly passing itself.
  const declared = record.declared_asset_count > 0;
  const reconciled = declared && record.unaccounted === 0;

  return (
    <>
      <PageHeader
        eyebrow="Collection"
        title={record.source_collection_ref}
        description={`${record.project_name} · collected ${formatDate(record.collected_on)}`}
        breadcrumb={<BackLink />}
        actions={
          <Badge tone={!declared ? "neutral" : reconciled ? "success" : "warning"} dot>
            {!declared
              ? "Nothing declared"
              : reconciled
                ? "Reconciled"
                : `${record.unaccounted} unaccounted`}
          </Badge>
        }
      />

      {!declared ? (
        <Alert tone="info" title="This collection carries no declaration" className="mb-4">
          The manifest did not state how many assets this collection contains, so
          there is nothing to reconcile {record.mapped_asset_count} mapped assets
          against. Ask the source to include a{" "}
          <code className="font-mono text-xs">declared_asset_count</code> column —
          without it, an asset that never arrived is indistinguishable from one
          that was never promised.
        </Alert>
      ) : !reconciled ? (
        <Alert tone="warning" title="This collection does not reconcile" className="mb-4">
          {record.declared_asset_count} assets were declared and{" "}
          {record.mapped_asset_count} are mapped. The{" "}
          <strong>{record.unaccounted}</strong> in between were collected but have
          nothing recording who is in them — which is not a state they may stay
          in. Ask the source for the missing manifest rows.
        </Alert>
      ) : null}

      <div className="stagger mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Declared"
          value={declared ? record.declared_asset_count : "—"}
          hint={declared ? undefined : "Not stated by the source"}
        />
        <StatTile label="Mapped" value={record.mapped_asset_count} />
        <StatTile
          label="Unaccounted"
          value={declared ? record.unaccounted : "—"}
          tone={!declared ? "neutral" : reconciled ? "neutral" : "attention"}
          hint={!declared ? "Cannot be computed" : reconciled ? "Fully reconciled" : "Needs attention"}
          icon={declared ? (reconciled ? <CheckCircle2 /> : <AlertTriangle />) : undefined}
        />
        <StatTile
          label="Assets flagged"
          value={exceptions.data?.flagged_asset_count ?? 0}
          tone={(exceptions.data?.flagged_asset_count ?? 0) > 0 ? "attention" : "neutral"}
          hint="Contain someone with no consent"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Reconciliation</CardTitle>
            </CardHeader>
            <CardBody>
              {declared ? (
                <Meter
                  label="Assets mapped"
                  value={record.mapped_asset_count}
                  max={record.declared_asset_count}
                  caption={
                    reconciled
                      ? "Every declared asset has a manifest row behind it."
                      : "The gap is assets collected with nobody recorded in them."
                  }
                />
              ) : (
                // A ratio needs a denominator. Drawing a meter against zero would
                // invent a limit the source never gave.
                <p className="text-sm leading-relaxed text-text-muted">
                  There is no declared count to reconcile against, so this
                  collection can only be reported as{" "}
                  <strong className="text-text">
                    {record.mapped_asset_count} assets mapped
                  </strong>
                  . Whether that is all of them is not something this system can
                  currently tell you.
                </p>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader className="flex items-center justify-between">
              <CardTitle>Assets</CardTitle>
              <span className="rounded-full bg-bg-inset px-2.5 py-0.5 text-xs font-medium tabular text-text-muted">
                {assets.data?.length ?? 0}
              </span>
            </CardHeader>

            {assets.isLoading ? (
              <CardBody>
                <Skeleton className="h-32" />
              </CardBody>
            ) : assets.error ? (
              <CardBody>
                <Alert tone="danger">{assets.error.userMessage()}</Alert>
              </CardBody>
            ) : (assets.data ?? []).length === 0 ? (
              <EmptyState
                illustration={<EmptyRecords />}
                title="No assets mapped"
                description="Nothing from this collection has been mapped to a subject yet."
              />
            ) : (
              <Table>
                <caption className="sr-only">
                  Assets in {record.source_collection_ref}
                </caption>
                <thead>
                  <tr>
                    <Th>Asset</Th>
                    <Th>Type</Th>
                    <Th className="text-right">Subjects</Th>
                    <Th className="text-right">Bystanders</Th>
                    <Th>State</Th>
                  </tr>
                </thead>
                <tbody>
                  {(assets.data ?? []).map((asset) => (
                    <Tr key={asset.asset_uuid}>
                      <Td>
                        <p className="font-medium">{asset.source_asset_ref}</p>
                        <Mono className="text-2xs">{asset.storage_ref}</Mono>
                      </Td>
                      <Td>{humanise(asset.asset_type)}</Td>
                      <Td className="text-right tabular">{asset.subject_count}</Td>
                      <Td className="text-right tabular">
                        {asset.bystander_count > 0 ? (
                          <span className="text-warning-text">{asset.bystander_count}</span>
                        ) : (
                          asset.bystander_count
                        )}
                      </Td>
                      <Td>
                        {asset.has_unmapped_subjects ? (
                          <Badge tone="warning" dot>
                            Unmapped subjects
                          </Badge>
                        ) : (
                          <Badge tone="success" dot>
                            Accounted for
                          </Badge>
                        )}
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
              <CardTitle>Provenance</CardTitle>
            </CardHeader>
            <CardBody>
              <DescriptionList>
                <DescriptionItem term="Source">
                  {record.source_name}
                  <span className="ml-1.5 text-text-subtle">{record.source_code}</span>
                </DescriptionItem>
                <DescriptionItem term="Project">
                  <Link
                    href={`/projects/${record.project_uuid}`}
                    className="text-accent-text underline underline-offset-2"
                  >
                    {record.project_name}
                  </Link>
                </DescriptionItem>
                <DescriptionItem term="Site">
                  {record.site_label ?? "—"}
                </DescriptionItem>
                <DescriptionItem term="Collected on">
                  {formatDate(record.collected_on)}
                </DescriptionItem>
                <DescriptionItem term="Agent">
                  {record.agent_ref ?? "—"}
                </DescriptionItem>
                <DescriptionItem term="Import batch">
                  <Link
                    href={`/imports/${record.batch_uuid}`}
                    className="text-accent-text underline underline-offset-2"
                  >
                    View batch
                  </Link>
                </DescriptionItem>
                <DescriptionItem term="Recorded">
                  {formatDateTime(record.created_at)}
                </DescriptionItem>
              </DescriptionList>
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}

function BackLink() {
  return (
    <Link href="/collections" className="inline-flex items-center gap-1.5 hover:text-text">
      <ArrowLeft className="size-3.5" aria-hidden="true" />
      All collections
    </Link>
  );
}
