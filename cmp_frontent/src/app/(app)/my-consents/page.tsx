/**
 * The data subject's own record.
 *
 * Three things she is entitled to see, and all three are here:
 *
 * - **What she agreed to**, per purpose.
 * - **The exact words she was shown** — matched on the hash copied into her
 *   artefact at capture, not the live notice, so a later correction cannot
 *   silently repoint her record at text she never saw.
 * - **Who her data was shared with** (s.11(1)(b)), answered from `export_line`
 *   rather than by somebody parsing an archived CSV.
 *
 * Withdrawal is one click from the record it concerns. Making it harder to find
 * than consent was is exactly what s.6(4) forbids.
 */
"use client";

import {
  History,
  Share2,
  ShieldOff,
} from "lucide-react";
import * as React from "react";

import { PageHeader } from "@/components/layout/app-shell";
import { EmptyConsent } from "@/components/ui/graphics";
import {
  Alert,
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  EmptyState,
  Mono,
  Skeleton,
} from "@/components/ui/primitives";
import { StatusBadge } from "@/components/ui/status";
import {
  useMyConsentGrants,
  useMyConsentTrail,
  useMyConsentNotice,
  useMyConsents,
  useMyDisclosures,
  useWithdraw,
} from "@/features/my-consents";
import type { MyConsent } from "@/types";
import { formatDateTime, formatDuration, humanise, shortHash } from "@/lib/format";
import { useToast } from "@/providers";
import { ActivityFeed } from "@/components/data-display/activity-feed";

export default function MyConsentsPage() {
  const consents = useMyConsents();
  const [open, setOpen] = React.useState<string | null>(null);

  return (
    <>
      <PageHeader
        title="Your consents"
        description="Everything you have agreed to, the exact wording you were shown, and who it has been shared with. You can withdraw at any time."
      />

      {consents.isLoading && <Skeleton className="h-48" />}

      {consents.error && (
        <Alert tone="danger" title="Could not load your consents">
          {consents.error.userMessage()}
        </Alert>
      )}

      {consents.data && consents.data.length === 0 && (
        <Card>
          <EmptyState
            illustration={<EmptyConsent />}
            title="No consent records"
            description="When you agree to a notice, it will appear here."
          />
        </Card>
      )}

      <div className="space-y-4">
        {consents.data?.map((consent) => (
          <ConsentCard
            key={consent.consent_uuid}
            consent={consent}
            expanded={open === consent.consent_uuid}
            onToggle={() =>
              setOpen(open === consent.consent_uuid ? null : consent.consent_uuid)
            }
          />
        ))}
      </div>

      <Disclosures />
    </>
  );
}

function ConsentCard({
  consent,
  expanded,
  onToggle,
}: {
  consent: MyConsent;
  expanded: boolean;
  onToggle: () => void;
}) {
  const toast = useToast();
  const grants = useMyConsentGrants(expanded ? consent.consent_uuid : undefined);
  const withdraw = useWithdraw(consent.consent_uuid);
  const [confirming, setConfirming] = React.useState<string[] | "all" | null>(null);
  const [trailOpen, setTrailOpen] = React.useState(false);
  const trail = useMyConsentTrail(trailOpen ? consent.consent_uuid : undefined);

  const active = !consent.is_withdrawal && consent.granted_count > 0;

  async function doWithdraw(purposes: string[] | "all") {
    try {
      const result = await withdraw.mutateAsync(
        purposes === "all" ? { all: true } : { purposes },
      );
      toast.success(
        "Withdrawal recorded",
        result.stopped.length
          ? `Stopped: ${result.stopped.join(", ")}.`
          : undefined,
      );
      setConfirming(null);
    } catch (err) {
      const message =
        err && typeof err === "object" && "userMessage" in err
          ? (err as { userMessage: () => string }).userMessage()
          : "Could not record the withdrawal.";
      toast.error("Withdrawal failed", message);
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <CardTitle>{consent.project_name}</CardTitle>
          <p className="mt-1 text-xs text-text-muted">
            {consent.notice_code} v{consent.version} · {consent.language_code} ·{" "}
            {formatDateTime(consent.affirmative_action_at)}
          </p>
        </div>
        <StatusBadge
          kind="consent"
          value={
            consent.is_withdrawal
              ? "withdrawn"
              : consent.granted_count === 0
                ? "declined"
                : consent.granted_count < consent.purpose_count
                  ? "partial"
                  : "consented"
          }
        />
      </CardHeader>

      <CardBody className="space-y-3">
        <p className="text-sm text-text-muted">
          {consent.granted_count === 0
            ? // A refusal is a decision, not an absence, and the wording says so.
              // s.6(1) protects the freedom to refuse; a record that reads like a
              // failure teaches people that refusing was a mistake.
              `You were asked about ${consent.purpose_count} purpose(s) and agreed to none.`
            : `You agreed to ${consent.granted_count} of ${consent.purpose_count} purpose(s).`}
        </p>

        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" onClick={onToggle}>
            {expanded
              ? "Hide details"
              : consent.granted_count === 0
                ? "See what you were asked"
                : "See what you agreed to"}
          </Button>
          {/* Every consent has a trail, refused ones included. That is the
              point: "freely given" is not demonstrable if somebody cannot see
              that their refusal was recorded, when, and against which notice. */}
          <Button variant="ghost" size="sm" onClick={() => setTrailOpen((v) => !v)}>
            <History className="size-4" />
            {trailOpen ? "Hide the record" : "What was recorded"}
          </Button>
          {active && (
            <Button variant="subtle" size="sm" onClick={() => setConfirming("all")}>
              <ShieldOff className="size-4" />
              Withdraw everything
            </Button>
          )}
        </div>

        {trailOpen && (
          <div className="rounded-lg border border-border bg-bg-subtle p-4">
            <h3 className="mb-1 text-sm font-medium">What was recorded</h3>
            <p className="mb-3 text-xs text-text-muted">
              The same record the Privacy Office sees, for this consent and every
              change to it. Oldest first.
            </p>
            <ActivityFeed
              entries={trail.data}
              isLoading={trail.isLoading}
              order="oldest"
              emptyTitle="Nothing recorded yet"
              emptyDescription="Entries appear here as things happen to this record."
            />
          </div>
        )}

        {confirming === "all" && (
          <Alert tone="warning" title="Withdraw all purposes?">
            <p>
              Processing for these purposes will stop. Data already collected is
              not deleted by a withdrawal — if you want it erased, make a rights
              request.
            </p>
            <div className="mt-3 flex gap-2">
              <Button
                variant="danger"
                size="sm"
                loading={withdraw.isPending}
                onClick={() => doWithdraw("all")}
              >
                Withdraw
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setConfirming(null)}>
                Keep my consent
              </Button>
            </div>
          </Alert>
        )}

        {expanded && (
          <div className="space-y-4 border-t border-border pt-4">
            {grants.isLoading ? (
              <Skeleton className="h-24" />
            ) : (
              <ul className="space-y-2">
                {grants.data?.map((grant) => (
                  <li
                    key={grant.purpose_uuid}
                    className="rounded-md border border-border p-3"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-medium">{grant.name}</p>
                        <p className="mt-0.5 text-xs text-text-muted">
                          {grant.description}
                        </p>
                      </div>
                      <StatusBadge
                        kind="consent"
                        value={grant.granted ? "consented" : "declined"}
                        dot={false}
                      />
                    </div>
                    <dl className="mt-2 grid gap-1 text-xs text-text-subtle sm:grid-cols-2">
                      <div>
                        <dt className="inline font-medium">Data: </dt>
                        <dd className="inline">
                          {grant.data_categories.map(humanise).join(", ")}
                        </dd>
                      </div>
                      <div>
                        <dt className="inline font-medium">Kept for: </dt>
                        <dd className="inline">{formatDuration(grant.retention_period)}</dd>
                      </div>
                    </dl>
                    {grant.granted && active && (
                      <Button
                        variant="subtle"
                        size="sm"
                        className="mt-2"
                        onClick={() => doWithdraw([grant.purpose_uuid])}
                        loading={withdraw.isPending}
                      >
                        Withdraw just this one
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}

            <ServedNotice consentUuid={consent.consent_uuid} />
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function ServedNotice({ consentUuid }: { consentUuid: string }) {
  const [show, setShow] = React.useState(false);
  const served = useMyConsentNotice(show ? consentUuid : undefined);

  if (!show) {
    return (
      <Button variant="ghost" size="sm" onClick={() => setShow(true)}>
        <History className="size-4" />
        Show the exact notice I was given
      </Button>
    );
  }

  if (served.isLoading) return <Skeleton className="h-32" />;

  const data = served.data as
    | {
        rendered_text: string;
        notice_content_hash: string;
        served_at: string;
        integrity: string;
        hash_matches: boolean;
      }
    | undefined;

  if (!data) return null;

  return (
    <div className="rounded-md border border-border bg-bg-subtle p-4">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-text-subtle">
          Served {formatDateTime(data.served_at)}
        </p>
        <span
          className={[
            "text-xs",
            data.hash_matches ? "text-success-text" : "text-danger-text",
          ].join(" ")}
        >
          {data.hash_matches ? "Integrity verified" : "Integrity check failed"}
        </span>
      </div>

      <div className="max-h-72 overflow-y-auto whitespace-pre-wrap text-sm leading-relaxed">
        {data.rendered_text}
      </div>

      <p className="mt-3 text-xs">
        <span className="text-text-subtle">Hash recorded at capture: </span>
        <Mono>{shortHash(data.notice_content_hash, 12)}</Mono>
      </p>

      {!data.hash_matches && (
        <Alert tone="danger" className="mt-3">
          {data.integrity}
        </Alert>
      )}
    </div>
  );
}

function Disclosures() {
  const disclosures = useMyDisclosures();
  const items = (disclosures.data ?? []) as Array<{
    export_uuid: string;
    export_type: string;
    exported_at: string;
    project_name: string;
    site_label: string;
    processor_name: string | null;
  }>;

  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Share2 className="size-4" aria-hidden="true" />
          Who your data has been shared with
        </CardTitle>
        <p className="mt-1 text-xs text-text-muted">
          Section 11(1)(b). Answered from the disclosure record, not from an
          archived file.
        </p>
      </CardHeader>

      {disclosures.isLoading ? (
        <CardBody>
          <Skeleton className="h-20" />
        </CardBody>
      ) : items.length === 0 ? (
        <EmptyState
          title="Not shared with anyone"
          description="No export containing your record has been generated."
        />
      ) : (
        <ul className="divide-y divide-border">
          {items.map((item) => (
            <li key={item.export_uuid} className="px-5 py-3">
              <p className="text-sm font-medium">
                {item.processor_name ?? item.site_label}
              </p>
              <p className="mt-0.5 text-xs text-text-muted">
                {item.project_name} · {formatDateTime(item.exported_at)}
              </p>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
