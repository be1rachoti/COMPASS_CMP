/**
 * Project detail.
 *
 * The transition controls are the interesting part. They are rendered entirely
 * from `GET /projects/{uuid}/transitions`: which transitions exist for this role,
 * whether each is currently allowed, and what is blocking the ones that are not.
 *
 * A blocked transition is shown as a *disabled button with its reason*, not
 * hidden. Hiding it leaves the user wondering why the thing they were told to do
 * is not there; showing the blocker tells them what to fix.
 */
"use client";

import {
  ArrowLeft,
  Copy,
  Download,
  FileCheck,
  Info,
  Link2,
  MapPin,
  ScrollText,
  ShieldCheck,
  Upload,
  UserCog,
} from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import * as React from "react";

import { PageHeader } from "@/components/layout/app-shell";
import { TransitionControls } from "@/features/projects/components/transition-controls";
import {
  AgentForm,
  ApprovalForm,
  AssignSiteOwnerDialog,
  ProjectForm,
  SiteForm,
  SiteOwner,
} from "@/features/projects/components";
import type { SiteWithOwner } from "@/types";
import { ExportForm } from "@/features/exchange/components/forms";
import { NoticeCopyForm, NoticeForm } from "@/features/notices/components";
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
import { ProjectProgress, StatusBadge } from "@/components/ui/status";
import { useLinks } from "@/features/consent";
import { useNotices } from "@/features/notices";
import {
  downloadApprovalProof,
  useApprovals,
  useProject,
  useProjectHistory,
  useProjectSummary,
  useSites,
} from "@/features/projects";
import { formatDate, formatDateTime, humanise, saveBlob, shortHash } from "@/lib/format";
import { useAuth, useToast } from "@/providers";

type Sheet =
  | { kind: "edit" }
  | { kind: "site" }
  | { kind: "notice" }
  | { kind: "notice-copy" }
  | { kind: "approval" }
  | { kind: "export" }
  | { kind: "agent"; siteUuid: string; siteLabel: string };

export default function ProjectDetailPage() {
  const params = useParams<{ uuid: string }>();
  const uuid = params.uuid;
  const { me } = useAuth();
  const [sheet, setSheet] = React.useState<Sheet | null>(null);
  const close = () => setSheet(null);

  const project = useProject(uuid);
  const summary = useProjectSummary(uuid);
  const history = useProjectHistory(uuid);
  const notices = useNotices(uuid);
  const sites = useSites(uuid);
  const links = useLinks(uuid);

  // Above the early returns: a hook after one runs in a different order on
  // the render that takes the branch, which React refuses.
  const [assigning, setAssigning] = React.useState<SiteWithOwner | null>(null);

  if (project.isLoading) return <DetailSkeleton />;

  if (project.error) {
    return (
      <Alert tone="danger" title="Could not load this project">
        {project.error.isNotFound
          ? "This project does not exist, or it is outside your scope."
          : project.error.userMessage()}
      </Alert>
    );
  }

  const p = project.data!;

  // Mirrors the server's permission matrix. The API is the authority - these
  // only decide whether a control is worth rendering, never whether it is
  // permitted, and every one of them is re-checked server-side.
  const isDpo = me?.role === "dpo";
  const isOwner = me?.role === "rnd_user";
  // The R&D User is included because they are the one who knows where collection
  // will physically happen. Leaving it to the DPO meant the DPO inventing a site
  // to get past their own publication screen.
  const canAddSite = isDpo || me?.role === "dco" || isOwner;
  // Minting a Field Agent link stays with the DPO and DCO: it is a credential
  // for the collection floor, not a project-setup step.
  const canManageSites = isDpo || me?.role === "dco";
  // Mirrors the server's rule in `projects.service.add_approval`. Approvals
  // evidence a project moving through review, so they belong to the window
  // when it is in review - before that there is nothing to approve, after it
  // the decision is already recorded.
  const canUploadApproval =
    p.project_status === "under_process" || p.project_status === "pending_approval";
  const canAssignSiteOwner = isDpo || me?.role === "admin";
  const canExport = isDpo || me?.role === "dco";
  const noticePublished = Boolean(p.current_notice_uuid);

  return (
    <>
      <PageHeader
        breadcrumb={
          <Link href="/projects" className="inline-flex items-center gap-1 hover:text-text">
            <ArrowLeft className="size-3.5" aria-hidden="true" />
            All projects
          </Link>
        }
        title={p.project_name}
        description={p.description ?? undefined}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge kind="project" value={p.project_status} />
            {/* Editing is permitted only while the project is in draft. */}
            {isOwner && p.project_status === "in_draft" && (
              <Button variant="secondary" size="sm" onClick={() => setSheet({ kind: "edit" })}>
                Edit
              </Button>
            )}
            {isDpo && (
              <>
                <Button variant="secondary" size="sm" onClick={() => setSheet({ kind: "notice" })}>
                  <ScrollText className="size-4" />
                  New notice
                </Button>
                {/* Most projects are a variation on one that already exists. The
                    server copies rather than shares — a notice belongs to one
                    project — so this is a starting point, not a link. */}
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setSheet({ kind: "notice-copy" })}
                >
                  <Copy className="size-4" />
                  Use an existing notice
                </Button>
              </>
            )}
            {/* Gated on the project's state as well as the role. The API
                refuses an approval outside under_process and pending_approval,
                and offering a control that 409s teaches people to distrust the
                ones that work. */}
            {isOwner && canUploadApproval && (
              <Button variant="secondary" size="sm" onClick={() => setSheet({ kind: "approval" })}>
                <FileCheck className="size-4" />
                Upload approval
              </Button>
            )}
            {canAddSite && (
              <Button variant="secondary" size="sm" onClick={() => setSheet({ kind: "site" })}>
                <MapPin className="size-4" />
                Add site
              </Button>
            )}
            {canExport && p.project_status === "approved" && (
              <Button variant="secondary" size="sm" onClick={() => setSheet({ kind: "export" })}>
                <Upload className="size-4" />
                Generate export
              </Button>
            )}
          </div>
        }
      />

      <div className="mb-6">
        <ProjectProgress status={p.project_status} />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <TransitionControls projectUuid={uuid} currentStatus={p.project_status} />

          <Card>
            <CardHeader>
              <CardTitle>Notices</CardTitle>
            </CardHeader>
            {notices.isLoading ? (
              <CardBody>
                <Skeleton className="h-16" />
              </CardBody>
            ) : !notices.data?.length ? (
              <EmptyState
                title="No notice yet"
                description="A project cannot leave draft without a notice carrying at least one purpose and every Rule 3 element."
              />
            ) : (
              <ul className="divide-y divide-border">
                {notices.data.map((notice) => (
                  <li key={notice.notice_uuid}>
                    <Link
                      href={`/notices/${notice.notice_uuid}`}
                      className="flex items-center justify-between gap-4 px-5 py-3 hover:bg-surface-hover"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium">
                          {notice.notice_code}{" "}
                          <span className="text-text-subtle">v{notice.version}</span>
                        </p>
                        <p className="mt-0.5 text-xs text-text-muted">
                          {notice.purpose_count ?? 0} purpose(s) ·{" "}
                          {notice.language_count ?? 0} language(s)
                          {notice.published_at &&
                            ` · published ${formatDateTime(notice.published_at)}`}
                        </p>
                      </div>
                      <StatusBadge kind="notice" value={notice.status} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <ApprovalsCard
            projectUuid={uuid}
            canUpload={isOwner && canUploadApproval}
            // Passed so the empty state can say *why* there is no upload
            // control, rather than leaving somebody to conclude the feature is
            // missing or that they lack the permission.
            projectStatus={p.project_status}
            onUpload={() => setSheet({ kind: "approval" })}
          />

          <Card>
            <CardHeader>
              <CardTitle>Collection sites</CardTitle>
            </CardHeader>
            {sites.isLoading ? (
              <CardBody>
                <Skeleton className="h-16" />
              </CardBody>
            ) : !sites.data?.length ? (
              <EmptyState
                title="No sites yet"
                description="Sites are the recipients named in the notice. The R&D User adds them — collection cannot start at a site that is not registered here."
              />
            ) : (
              <ul className="divide-y divide-border">
                {sites.data.map((site) => (
                  <li
                    key={site.site_uuid}
                    className="flex items-center justify-between gap-4 px-5 py-3"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{site.site_label}</p>
                      <p className="mt-0.5 text-xs text-text-muted">
                        {site.location ?? "Location not recorded"}
                        {site.processor_name && ` · operated by ${site.processor_name}`}
                      </p>
                      {/* Who is accountable, and whether this is the site the
                          project follows. A project spanning three campuses run
                          by three people needs to say which one decides. */}
                      <div className="mt-1">
                        <SiteOwner site={site} />
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {typeof site.active_links === "number" && site.active_links > 0 && (
                        <span className="text-xs text-text-subtle">
                          {site.active_links} active link(s)
                        </span>
                      )}
                      <StatusBadge kind="record" value={site.status} />
                      {/* DPO and administrator only. A DCO reassigning their own
                          sites could hand themselves somebody else's project —
                          the API refuses it, and offering the control anyway
                          would just produce a 403 on click. */}
                      {canAssignSiteOwner && site.status === "active" && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setAssigning(site)}
                        >
                          <UserCog className="size-4" />
                          {site.dco_name ? "Reassign" : "Assign"}
                        </Button>
                      )}
                      {/* A link may only exist for an approved project, so the
                          control is absent until it is. */}
                      {canManageSites &&
                        site.status === "active" &&
                        p.project_status === "approved" && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              setSheet({
                                kind: "agent",
                                siteUuid: site.site_uuid,
                                siteLabel: site.site_label,
                              })
                            }
                          >
                            <Link2 className="size-4" />
                            Create link
                          </Button>
                        )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>History</CardTitle>
              <p className="mt-1 text-xs text-text-muted">
                Append-only. Every transition, who made it, and why.
              </p>
            </CardHeader>
            {history.isLoading ? (
              <CardBody>
                <Skeleton className="h-24" />
              </CardBody>
            ) : (
              <ol className="divide-y divide-border">
                {history.data?.map((entry) => (
                  <li key={entry.history_uuid} className="px-5 py-3">
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      {entry.from_status ? (
                        <>
                          <StatusBadge kind="project" value={entry.from_status} dot={false} />
                          <span aria-hidden="true" className="text-text-subtle">
                            →
                          </span>
                        </>
                      ) : (
                        <span className="text-text-subtle">Created as</span>
                      )}
                      <StatusBadge kind="project" value={entry.to_status} dot={false} />
                    </div>
                    <p className="mt-1 text-xs text-text-muted">
                      {entry.actor_name} ({humanise(entry.actor_role)}) ·{" "}
                      {formatDateTime(entry.occurred_at)}
                    </p>
                    {entry.reason && (
                      <p className="mt-1 rounded bg-bg-inset px-2 py-1 text-xs text-text">
                        “{entry.reason}”
                      </p>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Details</CardTitle>
            </CardHeader>
            <CardBody>
              <DescriptionList>
                <DescriptionItem term="Internal name">
                  {p.internal_project_name ?? "—"}
                </DescriptionItem>
                <DescriptionItem term="Requesting team">
                  {p.requesting_team ?? "—"}
                </DescriptionItem>
                <DescriptionItem term="Data Collection Owner">
                  {p.dco_name ?? "Not assigned"}
                </DescriptionItem>
                <DescriptionItem term="Created by">
                  {p.created_by_name ?? "—"}
                </DescriptionItem>
                <DescriptionItem term="Created">
                  {formatDateTime(p.created_at)}
                </DescriptionItem>
                <DescriptionItem term="Reference">
                  <Mono>{p.project_uuid}</Mono>
                </DescriptionItem>
              </DescriptionList>
            </CardBody>
          </Card>

          {summary.data && (
            <Card>
              <CardHeader>
                <CardTitle>At a glance</CardTitle>
              </CardHeader>
              <CardBody className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  {Object.entries(summary.data.counts).map(([key, value]) => (
                    <div key={key}>
                      <p className="text-xs text-text-subtle">{humanise(key)}</p>
                      <p className="text-lg font-semibold tabular">{value}</p>
                    </div>
                  ))}
                </div>

                <div className="border-t border-border pt-3">
                  <p className="mb-2 text-xs font-medium uppercase tracking-wide text-text-subtle">
                    Consent
                  </p>
                  <div className="grid grid-cols-2 gap-3">
                    {Object.entries(summary.data.consents).map(([key, value]) => (
                      <div key={key}>
                        <p className="text-xs text-text-subtle">{humanise(key)}</p>
                        <p className="text-lg font-semibold tabular">{value}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </CardBody>
            </Card>
          )}

          {links.data && links.data.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Consent links</CardTitle>
              </CardHeader>
              <ul className="divide-y divide-border">
                {links.data.map((link) => (
                  <li key={link.link_uuid} className="px-5 py-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-medium">{link.site_label}</p>
                      <StatusBadge kind="link" value={link.status} />
                    </div>
                    <p className="mt-1 text-xs text-text-muted">
                      {link.use_count}
                      {link.max_uses !== null && ` of ${link.max_uses}`} used · expires{" "}
                      {formatDateTime(link.expires_at)}
                    </p>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {p.project_status === "approved" && (
            <Alert tone="info">
              <p className="flex items-start gap-2">
                <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                <span>
                  Adding a site now is a material change: it adds a recipient to a
                  published notice, so it requires a new notice version before
                  collection starts there.
                </span>
              </p>
            </Alert>
          )}
        </div>
      </div>

      <Dialog open={sheet?.kind === "edit"} onOpenChange={(o) => !o && close()}>
        <DialogContent title="Edit project" description="Drafts only.">
          <ProjectForm project={p} onDone={close} />
        </DialogContent>
      </Dialog>

      <Dialog open={sheet?.kind === "notice"} onOpenChange={(o) => !o && close()}>
        <DialogContent
          title="New notice"
          description="Every Rule 3 element is required before it can be published."
          size="lg"
        >
          <NoticeForm projectUuid={uuid} onDone={close} />
        </DialogContent>
      </Dialog>

      <Dialog open={sheet?.kind === "site"} onOpenChange={(o) => !o && close()}>
        <DialogContent title="Add a collection site">
          <SiteForm projectUuid={uuid} noticePublished={noticePublished} onDone={close} />
        </DialogContent>
      </Dialog>

      <Dialog open={sheet?.kind === "notice-copy"} onOpenChange={(o) => !o && close()}>
        <DialogContent
          title="Use an existing notice"
          description="Copies the wording, the purposes and every language rendition into this project as a fresh draft."
        >
          <NoticeCopyForm projectUuid={uuid} onDone={close} />
        </DialogContent>
      </Dialog>

      <Dialog open={sheet?.kind === "approval"} onOpenChange={(o) => !o && close()}>
        <DialogContent
          title="Upload an approval"
          description="The proof file is mandatory - an approval without one does not unlock the transition."
        >
          <ApprovalForm projectUuid={uuid} onDone={close} />
        </DialogContent>
      </Dialog>

      <Dialog open={sheet?.kind === "export"} onOpenChange={(o) => !o && close()}>
        <DialogContent title="Generate an export">
          <ExportForm projectUuid={uuid} onDone={close} />
        </DialogContent>
      </Dialog>

      <Dialog open={sheet?.kind === "agent"} onOpenChange={(o) => !o && close()}>
        <DialogContent
          title={
            sheet?.kind === "agent" ? `Consent link for ${sheet.siteLabel}` : "Consent link"
          }
          description="The token is shown once and cannot be retrieved again."
        >
          {sheet?.kind === "agent" && <AgentForm siteUuid={sheet.siteUuid} onDone={close} />}
        </DialogContent>
      </Dialog>
      <AssignSiteOwnerDialog site={assigning} onClose={() => setAssigning(null)} />
    </>
  );
}

function DetailSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-8 w-72" />
      <Skeleton className="h-4 w-96" />
      <Skeleton className="h-10 w-full max-w-xl" />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Skeleton className="h-40" />
          <Skeleton className="h-48" />
        </div>
        <Skeleton className="h-64" />
      </div>
    </div>
  );
}

/* ==================================================================== approvals */

/**
 * The approvals already on this project, and their proof files.
 *
 * The R&D User uploads a security approval to unlock `under_process ->
 * pending_approval`, and until now the page gave them an upload button and no
 * way to see what they had already uploaded — so the honest reading of the
 * screen was "nothing is here", which sent people uploading it twice.
 *
 * The proof download compares the hash the server served against the one
 * recorded at upload. A mismatch means the stored file is not the file that was
 * approved, and that is worth interrupting somebody about.
 */
function ApprovalsCard({
  projectUuid,
  canUpload,
  projectStatus,
  onUpload,
}: {
  projectUuid: string;
  canUpload: boolean;
  projectStatus: string;
  onUpload: () => void;
}) {
  const approvals = useApprovals(projectUuid);
  const toast = useToast();
  const [busy, setBusy] = React.useState<string | null>(null);

  const items = approvals.data ?? [];

  async function download(uuid: string, reference: string, recorded: string) {
    setBusy(uuid);
    try {
      const file = await downloadApprovalProof(uuid);
      saveBlob(file.blob, file.filename || `approval-${reference}`);

      if (file.contentHash && recorded && file.contentHash !== recorded) {
        toast.error(
          "Proof does not match its recorded hash",
          "The stored file differs from what was uploaded. Report this to the Privacy Office.",
        );
      } else {
        toast.success("Proof downloaded", "Hash matches the record.");
      }
    } catch (err) {
      toast.error(
        "Could not download the proof",
        err && typeof err === "object" && "userMessage" in err
          ? (err as { userMessage: () => string }).userMessage()
          : "The request failed.",
      );
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card>
      <CardHeader className="flex items-center justify-between">
        <CardTitle>Approvals</CardTitle>
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-bg-inset px-2.5 py-0.5 text-xs font-medium tabular text-text-muted">
            {items.length}
          </span>
          {canUpload && (
            <Button variant="ghost" size="sm" onClick={onUpload}>
              <FileCheck className="size-4" />
              Upload
            </Button>
          )}
        </div>
      </CardHeader>

      {approvals.isLoading ? (
        <CardBody>
          <Skeleton className="h-16" />
        </CardBody>
      ) : approvals.error ? (
        <CardBody>
          <Alert tone={approvals.error.isForbidden ? "info" : "danger"}>
            {approvals.error.isForbidden
              ? "Your role does not permit the approvals list."
              : approvals.error.userMessage()}
          </Alert>
        </CardBody>
      ) : items.length === 0 ? (
        <EmptyState
          title="No approval uploaded"
          description={
            canUpload
              ? "A security approval with its proof file is what unlocks the move to pending approval."
              : projectStatus === "in_draft"
                ? "Approvals are added once the project is under process. There is nothing to approve while it is still a draft."
                : "Approvals are added while a project is under review. This one has moved past that."
          }
          action={
            canUpload ? (
              <Button variant="primary" size="sm" onClick={onUpload}>
                Upload an approval
              </Button>
            ) : undefined
          }
        />
      ) : (
        <ul className="divide-y divide-border">
          {items.map((approval) => (
            <li
              key={approval.approval_uuid}
              className="flex flex-wrap items-center justify-between gap-3 px-5 py-3"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium">
                  {humanise(approval.approval_type)}
                  <span className="ml-1.5 font-normal text-text-muted">
                    {approval.reference_no}
                  </span>
                </p>
                <p className="mt-0.5 text-xs text-text-muted">
                  Approved {formatDate(approval.approved_on)} · uploaded{" "}
                  {formatDateTime(approval.uploaded_at)}
                  {approval.uploaded_by_name && ` by ${approval.uploaded_by_name}`}
                </p>
                <p className="mt-1 flex items-center gap-1.5 text-2xs text-text-subtle">
                  <ShieldCheck className="size-3" aria-hidden="true" />
                  <span className="font-mono">{shortHash(approval.proof_file_hash)}</span>
                </p>
              </div>

              <Button
                variant="secondary"
                size="sm"
                loading={busy === approval.approval_uuid}
                onClick={() =>
                  download(
                    approval.approval_uuid,
                    approval.reference_no,
                    approval.proof_file_hash,
                  )
                }
              >
                <Download className="size-4" />
                Proof
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
