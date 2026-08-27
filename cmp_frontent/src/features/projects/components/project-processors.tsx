/**
 * Who is collecting for this project, and anything waiting to be agreed.
 *
 * Once a project is approved its collectors are fixed — an approved project
 * collecting through an organisation the DPO never reviewed is the thing the
 * approval was for. But a study that expands to a second partner campus six
 * months in is ordinary, and forbidding it outright left that with nowhere to
 * go.
 *
 * So adding one after approval is a **request**, scoped to the one thing that
 * changed. The project does not go back for review: collection is live at its
 * existing sites, consent is being taken there, and suspending all of it to add
 * somewhere else would punish the parts nobody questioned.
 *
 * Two readers, one card. The R&D User asks and sees what is outstanding; the
 * DPO answers. What neither should have to do is work out from a list of names
 * which ones are real — so the status is on every row, and a pending one says
 * plainly that nothing can collect under it yet.
 */
"use client";

import { Building2, Check, Clock, Home, Plus, X } from "lucide-react";
import * as React from "react";

import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import {
  Alert,
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  Field,
  Select,
  Skeleton,
  Textarea,
} from "@/components/ui/primitives";
import { useDecideProcessor, useRequestProcessor } from "@/features/projects/mutations";
import { useProjectProcessors } from "@/features/projects/queries";
import { useProcessors } from "@/features/registry";
import { formatDate } from "@/lib/format";
import { useToast } from "@/providers";
import type { ProjectProcessor, ProjectStatus } from "@/types";

export function ProjectProcessors({
  projectUuid,
  projectStatus,
  canRequest,
  canDecide,
}: {
  projectUuid: string;
  projectStatus: ProjectStatus;
  /** The R&D User who owns it. Naming the collectors is the initiator's
   *  decision — the study is theirs and the partners are the ones they
   *  arranged. */
  canRequest: boolean;
  canDecide: boolean;
}) {
  const { data, isLoading } = useProjectProcessors(projectUuid);
  const [asking, setAsking] = React.useState(false);
  const [deciding, setDeciding] = React.useState<ProjectProcessor | null>(null);

  // Draft is the one state where adding is not a request: the DPO reviews the
  // whole project at approval, and everything on it with it.
  const needsApproval = projectStatus !== "in_draft";
  const pending = (data ?? []).filter((p) => p.status === "pending");

  return (
    <>
      <Card>
        <CardHeader className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle>Who is collecting</CardTitle>
            <p className="mt-1 text-xs text-text-muted">
              {needsApproval
                ? "Adding one now needs the DPO's agreement before anything can collect under it."
                : "The DPO reviews these when they approve the project."}
            </p>
          </div>
          {canRequest && projectStatus !== "closed" && (
            <Button variant="secondary" size="sm" onClick={() => setAsking(true)}>
              <Plus className="size-4" />
              {needsApproval ? "Request a collector" : "Add a collector"}
            </Button>
          )}
        </CardHeader>

        {isLoading ? (
          <CardBody>
            <Skeleton className="h-16" />
          </CardBody>
        ) : (
          <>
            {canDecide && pending.length > 0 && (
              <CardBody className="pb-0">
                <Alert tone="warning" title="Waiting on you">
                  {pending.length === 1
                    ? "A new collector has been proposed for this approved project."
                    : `${pending.length} new collectors have been proposed for this approved project.`}{" "}
                  Nothing can collect under them until you decide.
                </Alert>
              </CardBody>
            )}

            <ul className="divide-y divide-border">
              {(data ?? []).map((p) => (
                <ProcessorRow
                  key={p.processor_uuid}
                  processor={p}
                  canDecide={canDecide}
                  onDecide={() => setDeciding(p)}
                />
              ))}
            </ul>
          </>
        )}
      </Card>

      {asking && (
        <RequestDialog
          projectUuid={projectUuid}
          alreadyNamed={data ?? []}
          needsApproval={needsApproval}
          onClose={() => setAsking(false)}
        />
      )}
      {deciding && (
        <DecisionDialog
          projectUuid={projectUuid}
          processor={deciding}
          onClose={() => setDeciding(null)}
        />
      )}
    </>
  );
}

function ProcessorRow({
  processor: p,
  canDecide,
  onDecide,
}: {
  processor: ProjectProcessor;
  canDecide: boolean;
  onDecide: () => void;
}) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
          {p.legal_name}
          <StatusChip status={p.status} />
        </p>
        <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-text-muted">
          {p.is_in_house ? (
            <>
              <Home className="size-3" aria-hidden="true" />
              collected in-house
            </>
          ) : (
            <>
              <Building2 className="size-3" aria-hidden="true" />
              collected by a third party
            </>
          )}
          {p.status === "approved" && !p.has_site && (
            // The signal its collection owner is waiting on. Nothing else says
            // it: the site queues cannot show a processor that has no sites.
            <span className="text-warning-text">· no collection set up yet</span>
          )}
          {p.status === "pending" && p.requested_by_name && (
            <span>
              · asked by {p.requested_by_name} on {formatDate(p.added_at)}
            </span>
          )}
        </p>

        {/* A refusal is kept with its reason rather than deleted, because "we
            asked and were told no, because X" is a fact somebody will need. */}
        {p.status === "rejected" && p.decision_reason && (
          <p className="mt-1 text-xs italic text-text-subtle">
            &ldquo;{p.decision_reason}&rdquo;
            {p.decided_by_name ? ` — ${p.decided_by_name}` : ""}
          </p>
        )}
      </div>

      {canDecide && p.status === "pending" && (
        <Button variant="primary" size="sm" onClick={onDecide}>
          Decide
        </Button>
      )}
    </li>
  );
}

function StatusChip({ status }: { status: ProjectProcessor["status"] }) {
  if (status === "approved") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-success-border bg-success-subtle px-2 py-0.5 text-2xs font-medium text-success-text">
        <Check className="size-2.5" aria-hidden="true" />
        approved
      </span>
    );
  }
  if (status === "pending") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-warning-border bg-warning-subtle px-2 py-0.5 text-2xs font-medium text-warning-text">
        <Clock className="size-2.5" aria-hidden="true" />
        awaiting the DPO
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-border bg-bg-inset px-2 py-0.5 text-2xs font-medium text-text-subtle">
      <X className="size-2.5" aria-hidden="true" />
      refused
    </span>
  );
}

function RequestDialog({
  projectUuid,
  alreadyNamed,
  needsApproval,
  onClose,
}: {
  projectUuid: string;
  alreadyNamed: ProjectProcessor[];
  needsApproval: boolean;
  onClose: () => void;
}) {
  const toast = useToast();
  const request = useRequestProcessor(projectUuid);
  const { data: processors } = useProcessors({ status: "active", limit: 100 });
  const [selected, setSelected] = React.useState("");

  // A refused one may be asked for again — a DPO who said no in March should not
  // have to be argued with through a workaround in September. An approved one
  // may not: re-requesting would quietly withdraw it.
  const settled = new Set(
    alreadyNamed.filter((p) => p.status !== "rejected").map((p) => p.processor_uuid),
  );
  const available = (processors?.items ?? []).filter((p) => !settled.has(p.processor_uuid));
  const chosen = available.find((p) => p.processor_uuid === selected);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    try {
      const result = await request.mutateAsync(selected);
      toast[result.status === "pending" ? "info" : "success"](
        result.status === "pending" ? "Sent to the DPO" : "Collector added",
        result.message,
      );
      onClose();
    } catch (err) {
      toast.error(
        "Could not add that collector",
        err && typeof err === "object" && "userMessage" in err
          ? (err as { userMessage: () => string }).userMessage()
          : "Nothing has been changed.",
      );
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        title={needsApproval ? "Request a new collector" : "Add a collector"}
        description={
          needsApproval
            ? "This project is already approved, so the DPO has to agree before anything can collect under a new one."
            : "The DPO will review this along with the rest of the project."
        }
      >
        <form method="post" onSubmit={submit} className="space-y-4" noValidate>
          <Field label="Processor" required>
            {(props) => (
              <Select
                {...props}
                value={selected}
                onChange={(e) => setSelected(e.target.value)}
              >
                <option value="">Choose a processor…</option>
                {available.map((p) => (
                  <option key={p.processor_uuid} value={p.processor_uuid}>
                    {p.legal_name} ·{" "}
                    {p.is_in_house ? "collected in-house" : "collected by a third party"}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          {!available.length && (
            <Alert tone="info">
              Every active processor is already on this project.
            </Alert>
          )}

          {/* Where the work lands once it is agreed, said before asking. */}
          {chosen && needsApproval && (
            <Alert tone="info">
              If the DPO agrees, this goes to{" "}
              {chosen.is_in_house
                ? "you, to name the data sources and an R&D Collection Owner"
                : "the DCO Admin, to have its data sources assigned"}
              .
            </Alert>
          )}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={request.isPending} disabled={!selected}>
              {needsApproval ? "Send to the DPO" : "Add"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DecisionDialog({
  projectUuid,
  processor,
  onClose,
}: {
  projectUuid: string;
  processor: ProjectProcessor;
  onClose: () => void;
}) {
  const toast = useToast();
  const decide = useDecideProcessor(projectUuid);
  const [reason, setReason] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  async function answer(approved: boolean) {
    // Checked here as well as at the API and in the database, so the person
    // refusing is told before they submit rather than after: "no" with nothing
    // after it is a decision the R&D User cannot act on.
    if (!approved && !reason.trim()) {
      setError("Say why. The R&D User cannot act on a refusal with no reason.");
      return;
    }
    try {
      const result = await decide.mutateAsync({
        processorUuid: processor.processor_uuid,
        approved,
        reason: reason.trim() || null,
      });
      toast.success(approved ? "Collector approved" : "Collector refused", result.message);
      onClose();
    } catch (err) {
      setError(
        err && typeof err === "object" && "userMessage" in err
          ? (err as { userMessage: () => string }).userMessage()
          : "Could not record that decision.",
      );
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        title={`Collect through ${processor.legal_name}?`}
        description="This project is already approved. Agreeing adds a collector to it; nothing else about the project changes."
      >
        <div className="space-y-4">
          {error && <Alert tone="danger">{error}</Alert>}

          <Alert tone="info">
            {processor.is_in_house
              ? "Collected in-house. If you agree, it goes back to the R&D owner to name the data sources and an R&D Collection Owner."
              : "Collected by a third party. If you agree, it goes to the DCO Admin to have its data sources assigned."}
          </Alert>

          <Field
            label="Reason"
            hint="Required to refuse, and recorded either way. It is what the R&D User acts on."
          >
            {(props) => (
              <Textarea
                {...props}
                rows={3}
                value={reason}
                maxLength={1000}
                onChange={(e) => {
                  setReason(e.target.value);
                  setError(null);
                }}
                placeholder="No contract in place for this partner yet."
              />
            )}
          </Field>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="secondary" loading={decide.isPending} onClick={() => answer(false)}>
            <X className="size-4" />
            Refuse
          </Button>
          <Button variant="primary" loading={decide.isPending} onClick={() => answer(true)}>
            <Check className="size-4" />
            Approve
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
