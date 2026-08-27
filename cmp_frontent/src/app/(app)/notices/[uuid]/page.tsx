/**
 * Notice detail and publication.
 *
 * The publication checklist is the centrepiece. `GET /notices/{uuid}/checklist`
 * returns exactly what is blocking publication, so the DPO sees a list of things
 * to fix rather than a submit button that rejects her with one error at a time.
 *
 * Publication is presented as irreversible, because it is: the text and its hash
 * freeze at that moment, and every consent captured afterwards is consent to
 * exactly those words. A correction is a new version, never an edit.
 */
"use client";

import {
  AlertTriangle,
  ArrowLeft,
  Check,
  FileText,
  Globe,
  Lock,
  Pencil,
  Plus,
  SlidersHorizontal,
  StickyNote,
  X,
} from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import * as React from "react";

import { PageHeader } from "@/components/layout/app-shell";
import {
  LanguageForm,
  NoticeForm,
  NoticePurposesForm,
} from "@/features/notices/components";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import {
  Alert,
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  DescriptionItem,
  DescriptionList,
  EmptyState,
  Mono,
  Skeleton,
} from "@/components/ui/primitives";
import { StatusBadge } from "@/components/ui/status";
import {
  useNotice,
  useNoticeChecklist,
  useNoticeLanguages,
  useNoticePurposes,
  usePublishNotice,
} from "@/features/notices";
import { useApproveLanguage } from "@/features/notices";
import type { LanguageCode } from "@/types";
import { formatDateTime, formatDuration, humanise, shortHash } from "@/lib/format";
import { useAuth, useToast } from "@/providers";
import {
  Rule3Badge,
  Rule3OverrideDialog,
} from "@/features/notices/components/rule3-override";
import { NoticeText } from "@/features/notices/components/notice-text";
import type { PurposeOnNotice } from "@/types";

export default function NoticeDetailPage() {
  const { uuid } = useParams<{ uuid: string }>();
  const toast = useToast();
  const { me } = useAuth();

  const notice = useNotice(uuid);
  const checklist = useNoticeChecklist(uuid);
  const purposes = useNoticePurposes(uuid);
  const [narrowing, setNarrowing] = React.useState<PurposeOnNotice | null>(null);
  const languages = useNoticeLanguages(uuid);
  const publish = usePublishNotice(uuid);
  const approve = useApproveLanguage(uuid);

  const [confirming, setConfirming] = React.useState(false);
  const [editingNotice, setEditingNotice] = React.useState(false);
  const [editingPurposes, setEditingPurposes] = React.useState(false);
  const [languageSheet, setLanguageSheet] = React.useState<
    { code?: LanguageCode; approved?: boolean } | null
  >(null);

  if (notice.isLoading) return <Skeleton className="h-96" />;
  if (notice.error) {
    return (
      <Alert tone="danger" title="Could not load this notice">
        {notice.error.userMessage()}
      </Alert>
    );
  }

  const n = notice.data!;
  const isDpo = me?.role === "dpo";
  // Assembly belongs to the author. The R&D User writes the notice because they
  // are the one who knows what the study collects and why; asking the DPO to
  // author it meant the DPO transcribing an email and then reviewing their own
  // transcription, which is not a review.
  //
  // The server confines an R&D User to their own projects, so this flag being
  // role-wide is not a widening: a notice they cannot reach does not load.
  const canAuthor = isDpo || me?.role === "rnd_user";
  const isDraft = n.status === "draft" || n.status === "approved";

  async function onPublish() {
    try {
      await publish.mutateAsync();
      toast.success(
        "Notice published",
        "The text and its hash are frozen. Edits now require a new version.",
      );
      setConfirming(false);
    } catch (err) {
      const message =
        err && typeof err === "object" && "userMessage" in err
          ? (err as { userMessage: () => string }).userMessage()
          : "Publication failed.";
      toast.error("Could not publish", message);
    }
  }

  return (
    <>
      <PageHeader
        breadcrumb={
          <Link href="/projects" className="inline-flex items-center gap-1 hover:text-text">
            <ArrowLeft className="size-3.5" aria-hidden="true" />
            Projects
          </Link>
        }
        title={`${n.notice_code} · version ${n.version}`}
        description={
          n.published_at
            ? `Published ${formatDateTime(n.published_at)}. This text is frozen.`
            : "Draft. Nothing here has been shown to a data subject yet."
        }
        actions={
          <div className="flex items-center gap-2">
            <StatusBadge kind="notice" value={n.status} />
            {canAuthor && isDraft && (
              <Button variant="secondary" size="sm" onClick={() => setEditingNotice(true)}>
                <Pencil className="size-4" />
                Edit
              </Button>
            )}
          </div>
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {canAuthor && isDraft && checklist.data && (
            <Card
              className={
                checklist.data.publishable ? "border-success-border" : "border-warning-border"
              }
            >
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  {checklist.data.publishable ? (
                    <Check className="size-4 text-success" aria-hidden="true" />
                  ) : (
                    <AlertTriangle className="size-4 text-warning" aria-hidden="true" />
                  )}
                  Publication checklist
                </CardTitle>
                <p className="mt-1 text-xs text-text-muted">
                  Everything Rule 3 requires, and everything still missing.
                </p>
              </CardHeader>

              <CardBody className="space-y-4">
                {checklist.data.publishable ? (
                  <Alert tone="success">
                    This notice is complete and ready to publish.
                  </Alert>
                ) : (
                  <div>
                    <p className="mb-2 text-sm font-medium">
                      {checklist.data.blocking.length} item(s) blocking publication:
                    </p>
                    <ul className="space-y-1.5">
                      {checklist.data.blocking.map((item) => (
                        <li key={item} className="flex items-start gap-2 text-sm">
                          <X
                            className="mt-0.5 size-4 shrink-0 text-danger"
                            aria-hidden="true"
                          />
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <dl className="grid grid-cols-2 gap-3 border-t border-border pt-3 sm:grid-cols-4">
                  <Stat label="Purposes" value={checklist.data.purpose_count} />
                  <Stat label="Languages" value={checklist.data.language_count} />
                  <Stat
                    label="Approved"
                    value={checklist.data.approved_language_count}
                    warn={
                      checklist.data.approved_language_count < checklist.data.language_count
                    }
                  />
                  <Stat label="Sites" value={checklist.data.site_count} />
                </dl>

                {checklist.data.publishable && !confirming && (
                  <Button variant="primary" onClick={() => setConfirming(true)}>
                    Publish this notice
                  </Button>
                )}

                {confirming && (
                  <div className="rounded-md border border-warning-border bg-warning-subtle p-4">
                    <p className="flex items-start gap-2 text-sm font-medium text-warning-text">
                      <Lock className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                      Publishing is not reversible
                    </p>
                    <p className="mt-2 text-sm text-warning-text">
                      Every language rendition is hashed and frozen. The recipient
                      list is generated from the project&apos;s active sites. From
                      then on, everyone who consents is consenting to exactly this
                      text — a correction means a new version, and the people who
                      already consented will have consented to the old one.
                    </p>
                    <div className="mt-3 flex gap-2">
                      <Button
                        variant="primary"
                        size="sm"
                        loading={publish.isPending}
                        onClick={onPublish}
                      >
                        Publish and freeze
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                )}
              </CardBody>
            </Card>
          )}

          <NoticeText
            languages={languages.data}
            isLoading={languages.isLoading}
            canEdit={canAuthor && isDraft}
            onEdit={(lang) =>
              setLanguageSheet({
                code: lang.language_code,
                approved: Boolean(lang.approved_at),
              })
            }
          />

          <Card>
            <CardHeader className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <CardTitle>Purposes</CardTitle>
                <p className="mt-1 text-xs text-text-muted">
                  Rule 3(b): what each purpose enables, itemised, with its retention.
                </p>
              </div>
              {canAuthor && isDraft && (
                <Button variant="secondary" size="sm" onClick={() => setEditingPurposes(true)}>
                  <Plus className="size-4" />
                  Manage
                </Button>
              )}
            </CardHeader>
            {purposes.isLoading ? (
              <CardBody>
                <Skeleton className="h-24" />
              </CardBody>
            ) : !purposes.data?.length ? (
              <EmptyState
                title="No purposes attached"
                description="A notice with no purposes asks a data subject to agree to nothing in particular."
              />
            ) : (
              <ul className="divide-y divide-border">
                {purposes.data.map((purpose) => (
                  <li key={purpose.purpose_uuid} className="px-5 py-4">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-medium">{purpose.name}</p>
                        <p className="mt-0.5 text-xs text-text-muted">
                          {purpose.description}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        {purpose.is_mandatory && (
                          <span className="rounded-full border border-warning-border bg-warning-subtle px-2 py-0.5 text-2xs font-medium text-warning-text">
                            cannot be refused
                          </span>
                        )}
                        <Rule3Badge purpose={purpose} />
                        <StatusBadge kind="purpose" value={purpose.status} dot={false} />
                        {/* Draft only. A published notice is frozen and hashed;
                            changing what it says is a new version, not an edit,
                            and the API refuses it either way. */}
                        {canAuthor && isDraft && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setNarrowing(purpose)}
                            title="State Rule 3(b) more narrowly on this notice"
                          >
                            <SlidersHorizontal className="size-4" />
                            Narrow
                          </Button>
                        )}
                      </div>
                    </div>

                    <dl className="mt-2 grid gap-1 text-xs text-text-subtle sm:grid-cols-3">
                      <div>
                        <dt className="inline font-medium">Basis: </dt>
                        <dd className="inline">
                          {purpose.lawful_basis === "consent_s6"
                            ? "Consent (s.6)"
                            : `s.7 ${purpose.s7_clause ?? ""}`}
                        </dd>
                      </div>
                      <div>
                        <dt className="inline font-medium">Retention: </dt>
                        <dd className="inline">{formatDuration(purpose.retention_period)}</dd>
                      </div>
                      <div>
                        <dt className="inline font-medium">Categories: </dt>
                        <dd className="inline">
                          {purpose.data_categories.map(humanise).join(", ")}
                          {/* Named where they differ, because otherwise a
                              reviewer comparing this against the purpose
                              register would find two lists and no explanation. */}
                          {purpose.is_overridden && (
                            <span className="text-accent-text">
                              {" "}
                              (this notice only)
                            </span>
                          )}
                        </dd>
                      </div>
                    </dl>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Globe className="size-4" aria-hidden="true" />
                Legal approval, per language
              </CardTitle>
              <p className="mt-1 text-xs text-text-muted">
                The register of sign-off — read the text itself above. Approval is per
                language, not once per notice: a DPO who reads English and approves eight
                renditions has approved one.
              </p>
              {canAuthor && isDraft && (
                <Button
                  variant="secondary"
                  size="sm"
                  className="mt-2"
                  onClick={() => setLanguageSheet({})}
                >
                  <Plus className="size-4" />
                  Add a rendition
                </Button>
              )}
            </CardHeader>
            {languages.isLoading ? (
              <CardBody>
                <Skeleton className="h-20" />
              </CardBody>
            ) : !languages.data?.length ? (
              <EmptyState title="No renditions yet" />
            ) : (
              <ul className="divide-y divide-border">
                {languages.data.map((lang) => (
                  <li
                    key={lang.notice_language_uuid}
                    className="flex flex-wrap items-center justify-between gap-3 px-5 py-3"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium capitalize">{lang.language_code}</p>
                      <p className="mt-0.5 text-xs">
                        <span className="text-text-subtle">sha256 </span>
                        <Mono>{shortHash(lang.content_hash)}</Mono>
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {lang.approved_at ? (
                        <div className="text-right">
                          <span className="inline-flex items-center gap-1 text-xs text-success-text">
                            <Check className="size-3.5" aria-hidden="true" />
                            Approved
                          </span>
                          <p className="text-2xs text-text-subtle">
                            {lang.approved_by_name} · {formatDateTime(lang.approved_at)}
                          </p>
                        </div>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs text-warning-text">
                          <AlertTriangle className="size-3.5" aria-hidden="true" />
                          Not legally approved
                        </span>
                      )}

                      {canAuthor && isDraft && (
                        <>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              setLanguageSheet({
                                code: lang.language_code,
                                approved: Boolean(lang.approved_at),
                              })
                            }
                          >
                            <Pencil className="size-4" />
                            Edit
                          </Button>
                          {/* Approving stays with the DPO even though editing
                              does not. An author who could sign off their own
                              text would make the review a formality — and the
                              approved hash is what a data subject's consent is
                              matched against. */}
                          {isDpo && !lang.approved_at && (
                            <Button
                              variant="secondary"
                              size="sm"
                              loading={approve.isPending}
                              onClick={async () => {
                                try {
                                  await approve.mutateAsync(lang.language_code);
                                  toast.success(
                                    `${lang.language_code} approved`,
                                    "Its hash is what a data subject's consent will be matched against.",
                                  );
                                } catch (err) {
                                  toast.error(
                                    "Could not approve",
                                    err && typeof err === "object" && "userMessage" in err
                                      ? (err as { userMessage: () => string }).userMessage()
                                      : "Please try again.",
                                  );
                                }
                              }}
                            >
                              <Check className="size-4" />
                              Approve
                            </Button>
                          )}
                        </>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="size-4" aria-hidden="true" />
                Rule 3 elements
              </CardTitle>
            </CardHeader>
            <CardBody>
              <DescriptionList>
                <DescriptionItem term="Withdraw consent">
                  <a
                    href={n.withdraw_url}
                    className="break-all text-accent-text underline underline-offset-2"
                  >
                    {n.withdraw_url}
                  </a>
                </DescriptionItem>
                <DescriptionItem term="Exercise rights">
                  <a
                    href={n.exercise_rights_url}
                    className="break-all text-accent-text underline underline-offset-2"
                  >
                    {n.exercise_rights_url}
                  </a>
                </DescriptionItem>
                <DescriptionItem term="Board complaint">
                  <a
                    href={n.board_complaint_url}
                    className="break-all text-accent-text underline underline-offset-2"
                  >
                    {n.board_complaint_url}
                  </a>
                  <p className="mt-0.5 text-xs text-text-subtle">
                    The Data Protection Board portal — not the internal grievance
                    form.
                  </p>
                </DescriptionItem>
                <DescriptionItem term="DPO contact">{n.dpo_contact}</DescriptionItem>
                <DescriptionItem term="Applies to">
                  {n.applicable_to ? (
                    humanise(n.applicable_to)
                  ) : (
                    // Named as blocking rather than left blank, because it is:
                    // publication refuses without it, and "—" would read as a
                    // field nobody needed to fill in.
                    <span className="text-warning-text">
                      Not set — publication is blocked until this says who the
                      notice addresses
                    </span>
                  )}
                </DescriptionItem>
                <DescriptionItem term="Recipients">
                  {n.recipients_text ?? (
                    <span className="text-text-subtle">
                      Generated from the project&apos;s sites at publication
                    </span>
                  )}
                </DescriptionItem>
              </DescriptionList>
            </CardBody>
          </Card>

          {/* Its own card rather than a row in the list above, because it is
              addressed to a different reader. Everything above describes the
              notice; this is an instruction to whoever collects against it, and
              somebody scanning a description list will not read it as one.

              Never served to a data principal: the public endpoints name their
              columns explicitly, so it cannot reach them by being shown here. */}
          {n.note && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <StickyNote className="size-4" aria-hidden="true" />
                  For whoever collects against this notice
                </CardTitle>
              </CardHeader>
              <CardBody>
                <p className="whitespace-pre-wrap text-sm leading-relaxed">{n.note}</p>
                <p className="mt-2 text-xs text-text-subtle">
                  Not part of the notice. The data principal never sees this.
                </p>
              </CardBody>
            </Card>
          )}

          {!isDraft && (
            <Alert tone="info">
              <p className="flex items-start gap-2">
                <Lock className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                <span>
                  This notice is {n.status}. Its text and hashes are immutable —
                  the database refuses an edit. To change anything, publish a new
                  version.
                </span>
              </p>
            </Alert>
          )}
        </div>
      </div>

      <Dialog open={editingNotice} onOpenChange={setEditingNotice}>
        <DialogContent title="Edit notice" description="Drafts only." size="lg">
          <NoticeForm notice={n} onDone={() => setEditingNotice(false)} />
        </DialogContent>
      </Dialog>

      <Dialog open={editingPurposes} onOpenChange={setEditingPurposes}>
        <DialogContent
          title="Purposes on this notice"
          description="Only active purposes can be attached, and only while the notice is a draft."
          size="lg"
        >
          <NoticePurposesForm noticeUuid={uuid} onDone={() => setEditingPurposes(false)} />
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(languageSheet)} onOpenChange={(o) => !o && setLanguageSheet(null)}>
        <DialogContent
          title={languageSheet?.code ? `Edit ${languageSheet.code}` : "Add a rendition"}
          description="This exact text is hashed at publication and becomes the record of what was agreed to."
          size="lg"
        >
          {languageSheet && (
            <LanguageForm
              noticeUuid={uuid}
              existingCode={languageSheet.code}
              existingText={
                languages.data?.find((l) => l.language_code === languageSheet.code)
                  ?.rendered_text
              }
              wasApproved={languageSheet.approved}
              onDone={() => setLanguageSheet(null)}
            />
          )}
        </DialogContent>
      </Dialog>
      <Rule3OverrideDialog
        noticeUuid={uuid}
        purpose={narrowing}
        onClose={() => setNarrowing(null)}
      />
    </>
  );
}

function Stat({ label, value, warn }: { label: string; value: number; warn?: boolean }) {
  return (
    <div>
      <dt className="text-xs text-text-subtle">{label}</dt>
      <dd
        className={[
          "text-lg font-semibold tabular",
          warn ? "text-warning-text" : "text-text",
        ].join(" ")}
      >
        {value}
      </dd>
    </div>
  );
}
