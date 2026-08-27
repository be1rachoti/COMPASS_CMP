/**
 * Status rendering.
 *
 * Every status in the system is displayed through one of these, so a project in
 * `pending_approval` looks the same on the dashboard, in a table, and on its own
 * page. The mapping from status to colour lives here and nowhere else.
 *
 * Two rules held throughout:
 *
 * - Colour never carries meaning on its own. Each badge shows its label, so the
 *   information survives greyscale printing and colour-blindness.
 * - The label is the API's own vocabulary, humanised. Inventing friendlier names
 *   in the UI means a support conversation about "Awaiting sign-off" that has no
 *   counterpart in the database.
 */
"use client";

import type {
  BatchStatus,
  ConsentStatus,
  LinkStatus,
  NoticeStatus,
  ProjectStatus,
  PurposeStatus,
  RecordStatus,
  Role,
  UserStatus,
} from "@/types";

import { Pipeline } from "./charts";
import { Badge, type BadgeProps } from "./primitives";

type Tone = NonNullable<BadgeProps["tone"]>;

const PROJECT: Record<ProjectStatus, { tone: Tone; label: string }> = {
  in_draft: { tone: "neutral", label: "In Draft" },
  // Historical only. Merged into In Draft, and kept here because status-history
  // rows still name it — a badge that rendered the raw enum would be the one
  // place the old vocabulary leaked back out.
  under_process: { tone: "neutral", label: "In Draft" },
  pending_approval: { tone: "warning", label: "Pending Approval" },
  approved: { tone: "success", label: "Approved" },
  closed: { tone: "neutral", label: "Closed" },
};

const NOTICE: Record<NoticeStatus, { tone: Tone; label: string }> = {
  draft: { tone: "neutral", label: "Draft" },
  approved: { tone: "info", label: "Approved" },
  published: { tone: "success", label: "Published" },
  // Superseded is not a failure - it means a newer version exists - so it is
  // neutral, not a warning.
  superseded: { tone: "neutral", label: "Superseded" },
};

const PURPOSE: Record<PurposeStatus, { tone: Tone; label: string }> = {
  draft: { tone: "neutral", label: "Draft" },
  pending_approval: { tone: "warning", label: "Pending Approval" },
  active: { tone: "success", label: "Active" },
  retired: { tone: "neutral", label: "Retired" },
};

const CONSENT: Record<ConsentStatus, { tone: Tone; label: string }> = {
  consented: { tone: "success", label: "Consented" },
  partial: { tone: "info", label: "Partial" },
  declined: { tone: "neutral", label: "Declined" },
  // Withdrawal is a right being exercised, not an error. Amber, not red: red
  // frames the data subject's choice as a problem for the organisation.
  withdrawn: { tone: "warning", label: "Withdrawn" },
};

const LINK: Record<LinkStatus, { tone: Tone; label: string }> = {
  active: { tone: "success", label: "Active" },
  expired: { tone: "neutral", label: "Expired" },
  revoked: { tone: "danger", label: "Revoked" },
};

const USER: Record<UserStatus, { tone: Tone; label: string }> = {
  pending: { tone: "warning", label: "Pending" },
  active: { tone: "success", label: "Active" },
  suspended: { tone: "danger", label: "Suspended" },
  deactivated: { tone: "neutral", label: "Deactivated" },
};

const RECORD: Record<RecordStatus, { tone: Tone; label: string }> = {
  active: { tone: "success", label: "Active" },
  suspended: { tone: "warning", label: "Suspended" },
  terminated: { tone: "neutral", label: "Terminated" },
};

const BATCH: Record<BatchStatus, { tone: Tone; label: string }> = {
  received: { tone: "neutral", label: "Received" },
  validating: { tone: "info", label: "Validating" },
  accepted: { tone: "success", label: "Accepted" },
  // Partial is the one that needs attention: some rows are in, some are not.
  partial: { tone: "warning", label: "Partial" },
  rejected: { tone: "danger", label: "Rejected" },
};

const ROLE: Record<Role, { tone: Tone; label: string }> = {
  dpo: { tone: "accent", label: "DPO" },
  dco: { tone: "info", label: "Data Collection Owner" },
  // The same tone as a DCO, because it is the same kind of authority — wider,
  // not different. A separate colour would read as a separate job.
  dco_admin: { tone: "info", label: "DCO Admin" },
  rco: { tone: "info", label: "R&D Collection Owner" },
  rnd_user: { tone: "neutral", label: "R&D User" },
  admin: { tone: "warning", label: "Administrator" },
  data_subject: { tone: "neutral", label: "Data Subject" },
};

const REGISTRY: Record<string, Record<string, { tone: Tone; label: string }>> = {
  project: PROJECT,
  notice: NOTICE,
  purpose: PURPOSE,
  consent: CONSENT,
  link: LINK,
  user: USER,
  record: RECORD,
  batch: BATCH,
  role: ROLE,
};

export type StatusKind = keyof typeof REGISTRY;

export function StatusBadge({
  kind,
  value,
  dot = true,
  className,
}: {
  kind: StatusKind;
  value: string | null | undefined;
  dot?: boolean;
  className?: string;
}) {
  if (!value) return <span className="text-text-subtle">—</span>;

  const entry = REGISTRY[kind]?.[value];
  if (!entry) {
    // An unmapped value renders rather than crashing: the backend added a status
    // and this file has not caught up yet, which is a display gap, not an outage.
    return (
      <Badge tone="neutral" dot={dot} className={className}>
        {value.replace(/_/g, " ")}
      </Badge>
    );
  }
  return (
    <Badge tone={entry.tone} dot={dot} className={className}>
      {entry.label}
    </Badge>
  );
}

export function statusLabel(kind: StatusKind, value: string | null | undefined): string {
  if (!value) return "—";
  return REGISTRY[kind]?.[value]?.label ?? value.replace(/_/g, " ");
}

/**
 * The five-state project machine, drawn.
 *
 * Shown on a project page so somebody can see where the work is without reading
 * the history table. `Pipeline` owns the drawing; this owns the vocabulary, so
 * the labels here and in the badges cannot drift apart.
 *
 * `closed` is not a fifth step - it is where the machine stops. Rendering it as
 * a step would imply every project is meant to end up there.
 */
export function ProjectProgress({ status }: { status: ProjectStatus }) {
  const steps: ProjectStatus[] = [
    "in_draft",
    "under_process",
    "pending_approval",
    "approved",
  ];

  if (status === "closed") {
    return (
      <Pipeline
        steps={[]}
        currentIndex={-1}
        terminal={{ label: PROJECT.closed.label, note: "This project is closed." }}
      />
    );
  }

  return (
    <Pipeline
      steps={steps.map((step) => ({ key: step, label: PROJECT[step].label }))}
      currentIndex={steps.indexOf(status)}
    />
  );
}
