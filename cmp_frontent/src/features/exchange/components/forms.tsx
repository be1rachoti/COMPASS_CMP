/**
 * Export generation.
 *
 * Warns before it runs, because generating writes a disclosure record: one
 * `export_line` per subject in the file. That is what makes s.11(1)(b)
 * answerable, and it is also why re-generating to get a fresh copy is the wrong
 * move — downloading again is free and repeatable.
 *
 * The import flow lives in `import-wizard.tsx`.
 */
"use client";

import { AlertTriangle } from "lucide-react";
import * as React from "react";

import { FormError, useApiForm } from "@/components/forms";
import { DialogFooter } from "@/components/ui/dialog";
import { Alert, Button, Field, Select } from "@/components/ui/primitives";
import { useCreateExport } from "@/features/exchange";
import { useSites } from "@/features/projects";

import { useToast } from "@/providers";
import { exportSchema } from "@/features/exchange/schemas";

/* ==================================================================== export */

export function ExportForm({
  projectUuid,
  onDone,
}: {
  projectUuid: string;
  onDone: () => void;
}) {
  const toast = useToast();
  const create = useCreateExport(projectUuid);
  const { data: sites } = useSites(projectUuid);

  const form = useApiForm(exportSchema, { type: "collection_pack", site: "" });
  const type = form.watch("type");

  const onSubmit = form.submit(async (values) => {
    const result = await create.mutateAsync(values);
    toast.success(
      "Export generated",
      `${result.row_count} row(s). Download it from the Exports page — downloading is repeatable.`,
    );
    onDone();
  });

  return (
    <form method="post" onSubmit={onSubmit} noValidate>
      <FormError message={form.formError} />

      <div className="space-y-4">
        <Field label="What to export" error={form.formState.errors.type?.message} required>
          {(p) => (
            <Select {...p} {...form.register("type")}>
              <option value="collection_pack">
                Collection pack — identifiers and the consent link
              </option>
              <option value="consented_list">
                Consented list — the people who agreed
              </option>
            </Select>
          )}
        </Field>

        <Field label="Site" error={form.formState.errors.site?.message} required>
          {(p) => (
            <Select {...p} {...form.register("site")}>
              <option value="">Choose a site…</option>
              {(sites ?? []).map((s) => (
                <option key={s.site_uuid} value={s.site_uuid}>
                  {s.site_label}
                </option>
              ))}
            </Select>
          )}
        </Field>

        {type === "collection_pack" ? (
          <Alert tone="info">
            A collection pack contains project, notice and purpose identifiers plus
            the site&apos;s consent link. <strong>No person rows</strong>, which is what
            makes it safe to email.
          </Alert>
        ) : (
          <Alert tone="warning">
            <p className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <span>
                A consented list contains personal data. Generating it writes one
                disclosure row per subject — that record is what makes &ldquo;who was my
                data shared with?&rdquo; answerable, and it cannot be undone. Download
                the existing export instead if you only need another copy.
              </span>
            </p>
          </Alert>
        )}
      </div>

      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" loading={create.isPending}>
          Generate export
        </Button>
      </DialogFooter>
    </form>
  );
}
