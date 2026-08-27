/**
 * Generating a project's export.
 *
 * There is nothing to choose, which is the change. There were two exports and a
 * site picker: a JSON pack with the context and no people, and a CSV with the
 * people and no context — so an agent at the collection point needed both and
 * joined them by hand. One CSV per project carries the context on every row.
 *
 * What the export contains still varies, but by *who is asking* rather than by
 * anything on this form. A collection owner gets the people who consented at the
 * sites they run; a DPO gets all of them. Offering that as a control would be
 * offering somebody a choice they do not have.
 *
 * The warning is not decoration. This file carries names, emails and mobile
 * numbers, and generating it writes one disclosure row per person — the record
 * that makes "who was my data shared with?" answerable, and the reason
 * generating and downloading are separate.
 */
"use client";

import { AlertTriangle, Download } from "lucide-react";

import { FormError } from "@/components/forms";
import { DialogFooter } from "@/components/ui/dialog";
import { Alert, Button } from "@/components/ui/primitives";
import { useCreateExport } from "@/features/exchange";
import { useToast } from "@/providers";
import * as React from "react";

export function ExportForm({
  projectUuid,
  onDone,
}: {
  projectUuid: string;
  onDone: () => void;
}) {
  const toast = useToast();
  const create = useCreateExport(projectUuid);
  const [error, setError] = React.useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      const result = await create.mutateAsync();
      toast.success(
        "Export generated",
        result.row_count === 0
          ? "Nobody has consented on this project yet, so the file carries the project details only."
          : `${result.row_count} consent(s). Download it from the Exports page — downloading is repeatable.`,
      );
      onDone();
    } catch (err) {
      setError(
        err && typeof err === "object" && "userMessage" in err
          ? (err as { userMessage: () => string }).userMessage()
          : "Could not generate the export.",
      );
    }
  }

  return (
    <form method="post" onSubmit={submit} noValidate>
      <FormError message={error} />

      <div className="space-y-4">
        <Alert tone="warning">
          <p className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>
              This CSV contains personal data — name, email and mobile number for every
              person who consented. Generating it writes one disclosure row each. That
              record is what makes &ldquo;who was my data shared with?&rdquo; answerable,
              and it cannot be undone. If you only need another copy,{" "}
              <strong>download the existing export</strong> instead.
            </span>
          </p>
        </Alert>

        <Alert tone="info">
          One row per consent, carrying the project, the notice version and the site
          alongside the person — so an agent can tell whom each consent is against
          without a second file. People who have withdrawn are included and marked, because
          that is the row you most need to act on.
        </Alert>
      </div>

      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" loading={create.isPending}>
          <Download className="size-4" />
          Generate the export
        </Button>
      </DialogFooter>
    </form>
  );
}
