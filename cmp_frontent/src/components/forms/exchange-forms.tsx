/**
 * Import wizard and export generation.
 *
 * The import flow is two steps and refuses to collapse into one. `POST
 * /imports/validate` is a dry run — same parsing, same checks, nothing written —
 * and the submit button stays disabled until it has passed. A manifest arriving
 * from a third-party tool is the input you trust least, and finding out about a
 * malformed row after a partial write is much worse than finding out before.
 *
 * Export generation warns before it runs, because generating writes a disclosure
 * record: one `export_line` per subject in the file. That is what makes
 * s.11(1)(b) answerable, and it is also why re-generating to get a fresh copy is
 * the wrong move — downloading again is free and repeatable.
 */
"use client";

import { AlertTriangle, CheckCircle2, FileWarning } from "lucide-react";
import * as React from "react";
import { z } from "zod";

import { FileInput, FormError, useApiForm } from "@/components/forms/form";
import { DialogFooter } from "@/components/ui/dialog";
import { Alert, Button, Field, Mono, Select, Table, Td, Th, Tr } from "@/components/ui/primitives";
import {
  useCreateExport,
  useSubmitImport,
  useValidateImport,
} from "@/lib/mutations";
import { useProjects, useSites, useSources } from "@/lib/queries";
import type { DataSource, ImportValidation, Page } from "@/lib/types";
import { useToast } from "@/providers";

const MAX_MANIFEST_BYTES = 25 * 1024 * 1024;

/* ==================================================================== import */

export function ImportForm({ onDone }: { onDone: () => void }) {
  const toast = useToast();
  const validate = useValidateImport();
  const submit = useSubmitImport();

  const sources = useSources({ status: "active", limit: 100 }) as unknown as {
    data?: Page<DataSource>;
  };
  const { data: projects } = useProjects({ status: "approved", limit: 100 });

  const [source, setSource] = React.useState("");
  const [project, setProject] = React.useState("");
  const [file, setFile] = React.useState<File | null>(null);
  const [result, setResult] = React.useState<ImportValidation | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  // Any change to the inputs invalidates the dry run: it validated a different
  // file, and letting the submit button stay enabled would submit unchecked data.
  function reset<T>(setter: (v: T) => void) {
    return (value: T) => {
      setter(value);
      setResult(null);
      setError(null);
    };
  }

  function message(err: unknown, fallback: string): string {
    return err && typeof err === "object" && "userMessage" in err
      ? (err as { userMessage: () => string }).userMessage()
      : fallback;
  }

  async function runValidation() {
    if (!source || !file) {
      setError("Choose a source and a manifest first.");
      return;
    }
    setError(null);
    try {
      const outcome = await validate.mutateAsync({
        source,
        project: project || undefined,
        manifest: file,
      });
      setResult(outcome);
      if (outcome.valid) {
        toast.success("Manifest is valid", `${outcome.declared_rows} row(s) ready to import.`);
      }
    } catch (err) {
      setError(message(err, "The manifest could not be validated."));
    }
  }

  async function runImport() {
    if (!source || !project || !file) return;
    try {
      const outcome = await submit.mutateAsync({ source, project, manifest: file });
      if (outcome.accepted_rows === 0 && outcome.rejected_rows === 0) {
        // Idempotent replay: same bytes, same source, already accepted.
        toast.info("Nothing to do", "This file has already been imported. Nothing was written.");
      } else {
        toast.success(
          `Import ${outcome.status}`,
          `${outcome.accepted_rows} accepted, ${outcome.rejected_rows} rejected.`,
        );
      }
      onDone();
    } catch (err) {
      setError(message(err, "The import failed."));
    }
  }

  return (
    <div>
      <FormError message={error} />

      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Data source" hint="Where this manifest came from." required>
            {(p) => (
              <Select {...p} value={source} onChange={(e) => reset(setSource)(e.target.value)}>
                <option value="">Choose a source…</option>
                {sources.data?.items.map((s) => (
                  <option key={s.source_uuid} value={s.source_uuid}>
                    {s.name} · {s.source_code}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Field label="Project" hint="Only approved projects can receive a collection." required>
            {(p) => (
              <Select {...p} value={project} onChange={(e) => reset(setProject)(e.target.value)}>
                <option value="">Choose a project…</option>
                {projects?.items.map((pr) => (
                  <option key={pr.project_uuid} value={pr.project_uuid}>
                    {pr.project_name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>

        <FileInput
          label="Manifest"
          hint="CSV, up to 25 MB. Required columns: source_collection_ref, source_asset_ref, asset_type, collected_on, subject_role."
          accept=".csv,text/csv,application/json"
          maxBytes={MAX_MANIFEST_BYTES}
          file={file}
          onChange={reset(setFile)}
          required
        />

        <Button
          variant="secondary"
          loading={validate.isPending}
          disabled={!source || !file}
          onClick={runValidation}
        >
          Validate — dry run, writes nothing
        </Button>

        {result && <ValidationReport result={result} />}
      </div>

      <DialogFooter>
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button
          variant="primary"
          loading={submit.isPending}
          // Deliberately gated on a passing dry run. A manifest nobody has
          // checked is exactly the input that should not reach the database.
          disabled={!result?.valid || !project}
          onClick={runImport}
        >
          Import {result?.valid ? `${result.declared_rows} row(s)` : ""}
        </Button>
      </DialogFooter>
    </div>
  );
}

function ValidationReport({ result }: { result: ImportValidation }) {
  if (result.already_imported) {
    return (
      <Alert tone="info" title="Already imported">
        <p>
          This exact file has been imported before (batch {result.previous_batch_uuid}).
          Importing is idempotent, so submitting it again accepts nothing and
          reports zero rather than duplicating anything.
        </p>
      </Alert>
    );
  }

  if (result.valid) {
    return (
      <Alert tone="success" title="Manifest is valid">
        <p className="flex items-start gap-2">
          <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>
            {result.declared_rows} row(s) parsed with no errors. Nothing has been
            written yet.
          </span>
        </p>
        <p className="mt-2 text-xs">
          File SHA-256 <Mono>{result.file_sha256.slice(0, 16)}…</Mono>
        </p>
      </Alert>
    );
  }

  return (
    <div>
      <Alert tone="danger" title={`${result.error_count} problem(s) found`}>
        <p className="flex items-start gap-2">
          <FileWarning className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>
            Nothing has been written. Fix the manifest and validate again — this is
            exactly what the dry run is for.
          </span>
        </p>
      </Alert>

      <div className="mt-3 max-h-64 overflow-y-auto">
        <Table>
          <caption className="sr-only">Validation errors, first 200</caption>
          <thead>
            <tr>
              <Th>Row</Th>
              <Th>Field</Th>
              <Th>Problem</Th>
            </tr>
          </thead>
          <tbody>
            {result.errors.map((e, i) => (
              <Tr key={`${e.row}-${e.field}-${i}`}>
                <Td className="tabular">{e.row === 0 ? "file" : e.row}</Td>
                <Td className="font-mono text-xs">{e.field}</Td>
                <Td className="text-text-muted">{e.error}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </div>
    </div>
  );
}

/* ==================================================================== export */

const exportSchema = z.object({
  type: z.string().min(1, "Choose what to export"),
  site: z.string().min(1, "Choose a site"),
});

type ExportValues = z.infer<typeof exportSchema>;

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

  const form = useApiForm<ExportValues>(exportSchema, { type: "collection_pack", site: "" });
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
    <form onSubmit={onSubmit} noValidate>
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
