/**
 * Project transition controls.
 *
 * Rendered entirely from `GET /projects/{uuid}/transitions`. The frontend does
 * not know the transition table, which is the point: the alternative is a second
 * copy of the state machine that drifts from the backend, and drift here means
 * showing someone a button that fails on click.
 *
 * Three behaviours worth keeping:
 *
 * - A **blocked** transition renders as a disabled button *with its reason*.
 *   Hiding it leaves the user unable to work out what to fix.
 * - A transition that **requires a reason** opens a confirmation with a
 *   mandatory note. Returning a project to draft without saying why makes the
 *   history useless to whoever reads it next.
 * - A transition that **publishes the notice** says so before it runs, because
 *   publication freezes the text permanently.
 */
"use client";

import { AlertTriangle, ArrowRight, Lock } from "lucide-react";
import * as React from "react";

import {
  Alert,
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  Field,
  Skeleton,
  Textarea,
} from "@/components/ui/primitives";
import { statusLabel } from "@/components/ui/status";
import { useTransition, useTransitions } from "@/features/projects";
import type { ProjectStatus, TransitionOption } from "@/types";
import { useToast } from "@/providers";

export function TransitionControls({
  projectUuid,
  currentStatus,
}: {
  projectUuid: string;
  currentStatus: ProjectStatus;
}) {
  const toast = useToast();
  const { data, isLoading, error } = useTransitions(projectUuid);
  const transition = useTransition(projectUuid);

  const [pending, setPending] = React.useState<TransitionOption | null>(null);
  const [reason, setReason] = React.useState("");
  const [reasonError, setReasonError] = React.useState<string | null>(null);

  if (isLoading) {
    return (
      <Card>
        <CardBody>
          <Skeleton className="h-20" />
        </CardBody>
      </Card>
    );
  }

  if (error) return null;

  const available = data?.available ?? [];

  if (!available.length) {
    return (
      <Card>
        <CardBody className="flex items-start gap-3 text-sm text-text-muted">
          <Lock className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <p>
            {currentStatus === "closed"
              ? "This project is closed. Closed is terminal - there is no transition out of it."
              : "There is nothing for your role to do at this stage."}
          </p>
        </CardBody>
      </Card>
    );
  }

  async function run(option: TransitionOption, note: string) {
    try {
      const result = await transition.mutateAsync({
        to: option.to,
        reason: note.trim() || undefined,
      });
      toast.success(
        `Moved to ${statusLabel("project", result.to)}`,
        option.publishes_notice
          ? "The notice has been published and its text is now frozen."
          : undefined,
      );
      setPending(null);
      setReason("");
    } catch (err) {
      // The server is the authority on whether a transition is permitted; if it
      // refuses, show its sentence rather than paraphrasing.
      const message =
        err && typeof err === "object" && "userMessage" in err
          ? (err as { userMessage: () => string }).userMessage()
          : "The transition failed.";
      toast.error("Could not move this project", message);
    }
  }

  function onClick(option: TransitionOption) {
    if (!option.allowed) return;
    if (option.reason_required || option.publishes_notice) {
      setPending(option);
      setReason("");
      setReasonError(null);
      return;
    }
    void run(option, "");
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>What happens next</CardTitle>
        <p className="mt-1 text-xs text-text-muted">
          Currently {statusLabel("project", data?.current ?? currentStatus)}. These are
          the moves your role can make from here.
        </p>
      </CardHeader>

      <CardBody className="space-y-3">
        {available.map((option) => (
          <div
            key={option.to}
            className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border px-4 py-3"
          >
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 text-sm font-medium">
                Move to {statusLabel("project", option.to)}
                {option.publishes_notice && (
                  <span className="rounded-full border border-warning-border bg-warning-subtle px-2 py-0.5 text-2xs font-medium text-warning-text">
                    publishes the notice
                  </span>
                )}
              </p>
              {option.blocked_by && (
                <p className="mt-1 flex items-center gap-1.5 text-xs text-warning-text">
                  <AlertTriangle className="size-3.5 shrink-0" aria-hidden="true" />
                  {option.blocked_by}
                </p>
              )}
              {option.reason_required && option.allowed && (
                <p className="mt-1 text-xs text-text-muted">
                  A reason is required and is recorded in the history.
                </p>
              )}
            </div>

            <Button
              variant={option.allowed ? "primary" : "secondary"}
              size="sm"
              disabled={!option.allowed}
              onClick={() => onClick(option)}
              // The disabled reason is announced, not only shown.
              aria-describedby={option.blocked_by ? `blocked-${option.to}` : undefined}
              title={option.blocked_by}
            >
              {statusLabel("project", option.to)}
              <ArrowRight className="size-4" />
            </Button>
            {option.blocked_by && (
              <span id={`blocked-${option.to}`} className="sr-only">
                Blocked: {option.blocked_by}
              </span>
            )}
          </div>
        ))}

        {pending && (
          <div className="rounded-md border border-accent-border bg-accent-subtle p-4">
            <p className="text-sm font-medium text-accent-text">
              Move to {statusLabel("project", pending.to)}
            </p>

            {pending.publishes_notice && (
              <Alert tone="warning" className="mt-3">
                <p>
                  This publishes the project&apos;s notice. Its text and hash are
                  frozen at that moment and cannot be edited afterwards - a
                  correction requires a new version. The data subjects who consent
                  from now on are consenting to exactly this text.
                </p>
              </Alert>
            )}

            <div className="mt-3">
              <Field
                label={pending.reason_required ? "Reason" : "Note (optional)"}
                error={reasonError ?? undefined}
                required={pending.reason_required}
                hint={
                  pending.reason_required
                    ? "Whoever reads the history next needs to understand why this went back."
                    : undefined
                }
              >
                {(props) => (
                  <Textarea
                    {...props}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    rows={3}
                    placeholder={
                      pending.reason_required
                        ? "e.g. The site list is incomplete - Lab B is missing."
                        : ""
                    }
                  />
                )}
              </Field>
            </div>

            <div className="mt-3 flex gap-2">
              <Button
                variant="primary"
                size="sm"
                loading={transition.isPending}
                onClick={() => {
                  if (pending.reason_required && !reason.trim()) {
                    setReasonError("A reason is required for this transition.");
                    return;
                  }
                  void run(pending, reason);
                }}
              >
                Confirm
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setPending(null);
                  setReasonError(null);
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
