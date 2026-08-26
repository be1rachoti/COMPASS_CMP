/**
 * The import wizard.
 *
 * The flow was already right and read wrong. Three decisions happen in order —
 * where the data came from, what the file is, and whether to write it — and they
 * were presented as one flat form with a validate button in the middle. People
 * filled in what they could see, pressed Import, found it disabled, and had to
 * work out why from the absence of an explanation.
 *
 * So the steps are staged and named, each one unlocking the next, and the
 * reason a step is not yet available is written where somebody looking for it
 * would look. Nothing about what the API does has changed.
 *
 * What is new is the template. A person handed five column names guesses at the
 * date format and the vocabulary and finds out after uploading; the downloadable
 * CSV carries a worked example and per-column guidance, and the parser skips its
 * `#` lines so it survives being opened in Excel and saved.
 *
 * The dry run stays mandatory. A manifest nobody has checked is exactly the
 * input that should not reach the database, and the button says which of the two
 * things it does — checks, writes nothing — rather than leaving somebody to
 * discover that by pressing it.
 */
"use client";

import {
  CheckCircle2,
  Download,
  FileSpreadsheet,
  FileWarning,
  Info,
  Loader2,
} from "lucide-react";
import * as React from "react";

import { FileInput, FormError } from "@/components/forms";
import { DialogFooter } from "@/components/ui/dialog";
import { Alert, Button, Field, Mono, Select, Table, Td, Th, Tr } from "@/components/ui/primitives";
import { downloadManifestTemplate } from "@/features/exchange/api";
import { useSubmitImport, useValidateImport } from "@/features/exchange/mutations";
import { useProjects } from "@/features/projects";
import { useSources } from "@/features/registry";
import { saveBlob } from "@/lib/format";
import { useToast } from "@/providers";
import type { ImportValidation } from "@/types";

const MAX_MANIFEST_BYTES = 25 * 1024 * 1024;

/** The columns a manifest must carry, and what each one is for. */
const REQUIRED_COLUMNS: Array<{ name: string; help: string }> = [
  { name: "source_collection_ref", help: "Your reference for the collection session." },
  { name: "source_asset_ref", help: "Your reference for the file. Unique within the session." },
  { name: "asset_type", help: "image, video, audio, sensor, document or other." },
  { name: "collected_on", help: "When it was captured, YYYY-MM-DD. Not the upload date." },
  { name: "subject_role", help: "consented, incidental or unidentified." },
];

export function ImportWizard({ onDone }: { onDone: () => void }) {
  const toast = useToast();
  const validate = useValidateImport();
  const submit = useSubmitImport();

  const sources = useSources({ status: "active", limit: 100 });
  const { data: projects } = useProjects({ status: "approved", limit: 100 });

  const [source, setSource] = React.useState("");
  const [project, setProject] = React.useState("");
  const [file, setFile] = React.useState<File | null>(null);
  const [result, setResult] = React.useState<ImportValidation | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [downloading, setDownloading] = React.useState(false);

  /**
   * Any change to the inputs discards the dry run.
   *
   * It validated a different file, or a different destination for the same
   * file. Leaving the result standing would let somebody import bytes nobody
   * checked, which is the one thing this whole flow exists to prevent.
   */
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

  const describedDone = Boolean(source && project);
  const fileChosen = Boolean(file);
  const validated = Boolean(result?.valid);

  async function getTemplate() {
    setDownloading(true);
    try {
      const f = await downloadManifestTemplate();
      saveBlob(f.blob, f.filename || "collection-manifest-template.csv");
    } catch {
      toast.error("Could not download the template", "Try again in a moment.");
    } finally {
      setDownloading(false);
    }
  }

  async function runValidation() {
    if (!source || !file) return;
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

      <ol className="space-y-5">
        <Step
          index={1}
          title="Start from the template"
          state="available"
          hint="Optional, and the fastest way to get the columns right."
        >
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="secondary" onClick={getTemplate} loading={downloading}>
              <Download className="size-4" />
              Download the manifest template
            </Button>
            <span className="text-xs text-text-subtle">
              CSV with a worked example and notes on every column.
            </span>
          </div>

          <details className="mt-3 rounded-lg border border-border bg-bg-subtle">
            <summary className="cursor-pointer select-none px-3 py-2 text-xs font-medium text-text-muted">
              What the file must contain
            </summary>
            <dl className="space-y-2 px-3 pb-3 text-xs">
              {REQUIRED_COLUMNS.map((column) => (
                <div key={column.name} className="flex flex-wrap gap-x-2">
                  <dt className="font-mono text-text">{column.name}</dt>
                  <dd className="text-text-muted">{column.help}</dd>
                </div>
              ))}
            </dl>
          </details>
        </Step>

        <Step
          index={2}
          title="Where it came from, and where it goes"
          state="available"
          done={describedDone}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Data source" hint="The system this manifest came from." required>
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

            <Field
              label="Project"
              hint="Only approved projects can receive a collection."
              required
            >
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
        </Step>

        <Step
          index={3}
          title="Check the file"
          state={describedDone ? "available" : "locked"}
          lockedReason="Choose a source and a project first — the checks depend on both."
          done={validated}
        >
          <FileInput
            label="Manifest"
            hint="CSV, up to 25 MB."
            accept=".csv,text/csv"
            maxBytes={MAX_MANIFEST_BYTES}
            file={file}
            onChange={reset(setFile)}
            required
          />

          <Button
            variant="secondary"
            className="mt-3"
            loading={validate.isPending}
            disabled={!fileChosen}
            onClick={runValidation}
          >
            {validate.isPending ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <FileSpreadsheet className="size-4" aria-hidden="true" />
            )}
            Check it — this writes nothing
          </Button>

          {result && (
            <div className="mt-3">
              <ValidationReport result={result} />
            </div>
          )}
        </Step>
      </ol>

      <DialogFooter>
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button
          variant="primary"
          loading={submit.isPending}
          // Gated on a passing dry run, and the disabled state now has an
          // explanation above it rather than being a dead control somebody has
          // to reverse-engineer.
          disabled={!validated || !project}
          onClick={runImport}
        >
          {validated ? `Import ${result?.declared_rows} row(s)` : "Import"}
        </Button>
      </DialogFooter>
    </div>
  );
}

/**
 * One numbered step.
 *
 * A locked step is shown, dimmed, with the reason — rather than hidden. Hiding
 * it means somebody looking for the upload cannot find it and does not know
 * whether the product has it at all.
 */
function Step({
  index,
  title,
  hint,
  state,
  lockedReason,
  done,
  children,
}: {
  index: number;
  title: string;
  hint?: string;
  state: "available" | "locked";
  lockedReason?: string;
  done?: boolean;
  children: React.ReactNode;
}) {
  const locked = state === "locked";

  return (
    // No `aria-disabled`: it is not a supported attribute on a listitem, and
    // the locked reason is announced as text, which is better than a state a
    // screen reader would have to explain.
    <li className={locked ? "opacity-55" : undefined}>
      <div className="mb-2 flex items-baseline gap-2.5">
        <span
          aria-hidden="true"
          className={
            done
              ? "grid size-6 shrink-0 place-items-center rounded-full bg-success text-xs font-semibold text-white"
              : "grid size-6 shrink-0 place-items-center rounded-full border border-border-strong text-xs font-semibold text-text-muted"
          }
        >
          {done ? <CheckCircle2 className="size-3.5" /> : index}
        </span>
        <div className="min-w-0">
          <h3 className="text-sm font-medium text-text">{title}</h3>
          {hint && <p className="mt-0.5 text-xs text-text-subtle">{hint}</p>}
        </div>
      </div>

      <div className="pl-[34px]">
        {locked ? (
          <p className="flex items-start gap-2 text-xs text-text-subtle">
            <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            {lockedReason}
          </p>
        ) : (
          children
        )}
      </div>
    </li>
  );
}

function ValidationReport({ result }: { result: ImportValidation }) {
  if (result.already_imported) {
    return (
      <Alert tone="info" title="Already imported">
        <p>
          This exact file has been imported before (batch {result.previous_batch_uuid}).
          Importing is idempotent, so submitting it again accepts nothing and reports
          zero rather than duplicating anything.
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
            {result.declared_rows} row(s) parsed with no errors. Nothing has been written
            yet.
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
            Nothing has been written. Fix the manifest and check it again — this is
            exactly what the dry run is for.
          </span>
        </p>
      </Alert>

      {/* Row and column, because a message without a location is a message
          somebody has to search a spreadsheet for. */}
      <div className="mt-3 max-h-64 overflow-y-auto">
        <Table>
          <caption className="sr-only">Validation errors, first 200</caption>
          <thead>
            <tr>
              <Th>Row</Th>
              <Th>Column</Th>
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
