/**
 * One consent record, staff view.
 *
 * This page is the evidence. If a regulator asks "prove she consented", the
 * answer is what is on this screen: which notice she was shown, its content
 * hash, when the server served it, when she acted, and which purposes she
 * agreed to one by one.
 *
 * Two things are deliberate:
 *
 * - **Purposes are listed individually with a yes/no**, never summarised as
 *   "3 of 5". Consent under the Act is per purpose; a count hides which ones.
 * - **The staff view shows contact details and nothing else personal.** The
 *   asset list says *which* assets contain her, not what is in them.
 *
 * A withdrawal is a record in its own right - it supersedes rather than edits -
 * so a withdrawal record here is complete and correct, not a defaced consent.
 */
"use client";

import { ArrowLeft, Info } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import * as React from "react";

import { PageHeader } from "@/components/app-shell";
import { StackedBar, type Segment } from "@/components/ui/charts";
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
import { StatusBadge } from "@/components/ui/status";
import { useConsent, useConsentAssets, useConsentGrants } from "@/features/consent";
import type { PurposeGrant } from "@/types";
import { formatDate, formatDateTime, formatDuration, humanise, shortHash } from "@/lib/format";

export default function ConsentDetailPage() {
  const { uuid } = useParams<{ uuid: string }>();

  const consent = useConsent(uuid);
  const grants = useConsentGrants(uuid);
  const assets = useConsentAssets(uuid);

  if (consent.error) {
    return (
      <>
        <PageHeader
          title="Consent record"
          breadcrumb={<BackLink />}
        />
        <Alert tone="danger" title="Could not load this record">
          {consent.error.isForbidden
            ? "Your role does not permit this record. The attempt has been recorded in the audit trail."
            : consent.error.userMessage()}
        </Alert>
      </>
    );
  }

  if (consent.isLoading || !consent.data) {
    return (
      <>
        <PageHeader title="Consent record" breadcrumb={<BackLink />} />
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <Skeleton className="h-80" />
          <Skeleton className="h-64" />
        </div>
      </>
    );
  }

  const record = consent.data;
  const granted = (grants.data ?? []).filter((g) => g.granted).length;
  const refused = (grants.data ?? []).length - granted;

  // The derived status, computed the same way the register computes it. A
  // withdrawal supersedes; otherwise it is what she actually agreed to.
  const status = record.is_withdrawal
    ? "withdrawn"
    : granted === 0
      ? "declined"
      : refused === 0
        ? "consented"
        : "partial";

  const composition: Segment[] = [
    { key: "granted", label: "Agreed", value: granted, color: "var(--viz-1)" },
    { key: "refused", label: "Not agreed", value: refused, color: "var(--viz-neutral)" },
  ];

  return (
    <>
      <PageHeader
        eyebrow="Consent"
        title={record.subject_name}
        description={`${record.project_name} · ${record.site_label}`}
        breadcrumb={<BackLink />}
        actions={<StatusBadge kind="consent" value={status} />}
      />

      {record.is_withdrawal && (
        <Alert tone="warning" title="This record is a withdrawal" className="mb-4">
          It supersedes an earlier consent rather than replacing it. The earlier
          record still exists and is still evidence of what was agreed at the
          time.
        </Alert>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Purposes</CardTitle>
              <p className="mt-1 text-sm text-text-muted">
                Consent is given purpose by purpose. Each line is a separate
                decision she made.
              </p>
            </CardHeader>
            <CardBody>
              {grants.isLoading ? (
                <Skeleton className="h-40" />
              ) : grants.error ? (
                <Alert tone="danger">{grants.error.userMessage()}</Alert>
              ) : (grants.data ?? []).length === 0 ? (
                <EmptyState
                  illustration={<EmptyRecords />}
                  title="No purposes recorded"
                  description="This record carries no purpose grants, which should not happen — raise it with the Privacy Office."
                />
              ) : (
                <>
                  <StackedBar
                    segments={composition}
                    caption={`${granted} of ${granted + refused} purposes agreed.`}
                  />
                  <ul className="mt-5 divide-y divide-border">
                    {(grants.data ?? []).map((grant) => (
                      <GrantRow key={grant.purpose_uuid} grant={grant} />
                    ))}
                  </ul>
                </>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Assets containing this person</CardTitle>
              <p className="mt-1 text-sm text-text-muted">
                The reverse lookup an erasure request depends on: which collected
                assets she appears in.
              </p>
            </CardHeader>
            {assets.isLoading ? (
              <CardBody>
                <Skeleton className="h-24" />
              </CardBody>
            ) : assets.error ? (
              <CardBody>
                <Alert tone={assets.error.isForbidden ? "info" : "danger"}>
                  {assets.error.isForbidden
                    ? "Your role does not permit the asset lookup."
                    : assets.error.userMessage()}
                </Alert>
              </CardBody>
            ) : (assets.data ?? []).length === 0 ? (
              <EmptyState
                illustration={<EmptyRecords />}
                title="No assets mapped"
                description="Nothing collected has been mapped to this person yet."
              />
            ) : (
              <Table>
                <caption className="sr-only">
                  Assets containing {record.subject_name}
                </caption>
                <thead>
                  <tr>
                    <Th>Asset</Th>
                    <Th>Source</Th>
                    <Th>Collected</Th>
                    <Th>Role</Th>
                    <Th>Disposition</Th>
                  </tr>
                </thead>
                <tbody>
                  {(assets.data ?? []).map((asset) => (
                    <Tr key={asset.asset_uuid}>
                      <Td>
                        <p className="font-medium">{asset.source_asset_ref}</p>
                        <p className="text-xs text-text-subtle">
                          {humanise(asset.asset_type)}
                        </p>
                      </Td>
                      <Td>
                        <p>{asset.source_name}</p>
                        <p className="text-xs text-text-subtle">{asset.source_code}</p>
                      </Td>
                      <Td className="whitespace-nowrap">{formatDate(asset.collected_on)}</Td>
                      <Td>{asset.subject_role ? humanise(asset.subject_role) : "—"}</Td>
                      <Td>
                        {asset.disposition ? (
                          <Badge tone={asset.disposition === "erased" ? "neutral" : "info"}>
                            {humanise(asset.disposition)}
                          </Badge>
                        ) : (
                          <span className="text-text-subtle">Retained</span>
                        )}
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
        </div>

        {/* ------------------------------------------------------ the evidence */}
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Evidence</CardTitle>
            </CardHeader>
            <CardBody className="space-y-4">
              <DescriptionList>
                <DescriptionItem term="Notice">
                  <Link
                    href={`/notices/${record.notice_uuid}`}
                    className="text-accent-text underline underline-offset-2"
                  >
                    {record.notice_code}
                  </Link>{" "}
                  <span className="text-text-subtle">v{record.version}</span>
                </DescriptionItem>
                <DescriptionItem term="Language">
                  {humanise(record.language_code)}
                </DescriptionItem>
                <DescriptionItem term="Content hash">
                  <Mono title={record.notice_content_hash}>
                    {shortHash(record.notice_content_hash)}
                  </Mono>
                </DescriptionItem>
                <DescriptionItem term="Served at">
                  {formatDateTime(record.served_at)}
                </DescriptionItem>
                <DescriptionItem term="Acted at">
                  {formatDateTime(record.affirmative_action_at)}
                </DescriptionItem>
                <DescriptionItem term="Action">
                  {humanise(record.action_type)}
                </DescriptionItem>
              </DescriptionList>

              <p className="flex items-start gap-2 rounded-lg bg-bg-subtle p-3 text-xs leading-relaxed text-text-muted">
                <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                <span>
                  The gap between <strong>served</strong> and <strong>acted</strong> is
                  what evidences s.5(1) — that the notice was given before consent
                  was asked for. Both timestamps come from the server.
                </span>
              </p>
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Data subject</CardTitle>
            </CardHeader>
            <CardBody>
              <DescriptionList>
                <DescriptionItem term="Name">{record.subject_name}</DescriptionItem>
                <DescriptionItem term="Email">{record.subject_email}</DescriptionItem>
                <DescriptionItem term="Mobile">
                  {record.subject_mobile ?? "—"}
                </DescriptionItem>
                <DescriptionItem term="Site">{record.site_label}</DescriptionItem>
                <DescriptionItem term="Project">
                  <Link
                    href={`/projects/${record.project_uuid}`}
                    className="text-accent-text underline underline-offset-2"
                  >
                    {record.project_name}
                  </Link>
                </DescriptionItem>
                <DescriptionItem term="Record">
                  <Mono title={record.consent_uuid}>{shortHash(record.consent_uuid)}</Mono>
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

function GrantRow({ grant }: { grant: PurposeGrant }) {
  return (
    <li className="py-3 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium">{grant.name}</p>
          <p className="text-xs text-text-subtle">{grant.purpose_code}</p>
        </div>
        {/* The word carries the meaning; the colour only reinforces it. */}
        <Badge tone={grant.granted ? "success" : "neutral"} dot>
          {grant.granted ? "Agreed" : "Not agreed"}
        </Badge>
      </div>

      <p className="mt-1.5 text-sm leading-relaxed text-text-muted">{grant.description}</p>

      <dl className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-text-subtle">
        <div className="flex gap-1.5">
          <dt>Lawful basis:</dt>
          <dd className="text-text-muted">{humanise(grant.lawful_basis)}</dd>
        </div>
        <div className="flex gap-1.5">
          <dt>Retention:</dt>
          <dd className="text-text-muted">{formatDuration(grant.retention_period)}</dd>
        </div>
        <div className="flex gap-1.5">
          <dt>Categories:</dt>
          <dd className="text-text-muted">
            {grant.data_categories.map(humanise).join(", ")}
          </dd>
        </div>
      </dl>
    </li>
  );
}

function BackLink() {
  return (
    <Link
      href="/consents"
      className="inline-flex items-center gap-1.5 hover:text-text"
    >
      <ArrowLeft className="size-3.5" aria-hidden="true" />
      All consents
    </Link>
  );
}
