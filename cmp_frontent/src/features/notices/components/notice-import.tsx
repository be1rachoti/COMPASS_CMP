/**
 * Creating a notice from the document legal wrote.
 *
 * Until now a notice could only be typed into a form. The wording is drafted in
 * Word by the people whose job it is, and retyping it is where the notice and
 * the document it was approved as begin to differ — so the document itself is
 * what gets uploaded, and the purposes in its table become purposes in the
 * register.
 *
 * Two steps, and the first is not skippable. A dry run reports what the parser
 * understood and writes nothing; only then is the import offered. That ordering
 * is the whole point: a notice document is long, its purpose table is the part
 * that becomes rows in a register, and "it looked fine" is not a check. What the
 * check reports is what the import will do — both call the same parser.
 *
 * The screen leads with the purposes rather than the prose. The prose is the
 * part the uploader already read; the purposes are what the system inferred from
 * a table, and the place a misread column would show up.
 */
"use client";

import { AlertTriangle, CheckCircle2, FileText, Info, Loader2 } from "lucide-react";
import * as React from "react";

import { FileInput, FormError } from "@/components/forms";
import { DialogFooter } from "@/components/ui/dialog";
import { Alert, Badge, Button, Mono, Table, Td, Th, Tr } from "@/components/ui/primitives";
import { downloadNoticeTemplate } from "@/features/notices/api";
import { useImportNoticeDocument, useValidateNoticeDocument } from "@/features/notices";
import { saveBlob } from "@/lib/format";
import { useToast } from "@/providers";
import type { NoticeDocumentReport, Uuid } from "@/types";

const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;

export function NoticeImportForm({
  projectUuid,
  onDone,
}: {
  projectUuid: Uuid;
  onDone: () => void;
}) {
  const toast = useToast();
  const check = useValidateNoticeDocument(projectUuid);
  const submit = useImportNoticeDocument(projectUuid);

  const [file, setFile] = React.useState<File | null>(null);
  const [report, setReport] = React.useState<NoticeDocumentReport | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  // A new file invalidates the previous verdict. Leaving it on screen would let
  // somebody check one document and import another.
  function pick(next: File | null) {
    setFile(next);
    setReport(null);
    setError(null);
  }

  async function runCheck() {
    if (!file) return;
    setError(null);
    try {
      setReport(await check.mutateAsync(file));
    } catch (caught) {
      setReport(null);
      setError(caught instanceof Error ? caught.message : "The document could not be read.");
    }
  }

  async function runImport() {
    if (!file) return;
    setError(null);
    try {
      const notice = await submit.mutateAsync(file);
      toast.success(
        "Notice created",
        `${notice.notice_code} carries ${report?.purposes.length ?? 0} purposes. The DPO ` +
          "activates them before it can be published.",
      );
      onDone();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The import failed.");
    }
  }

  return (
    <div className="space-y-4">
      <FormError message={error} />

      {/* Before the file input, because it is the step before choosing a file
          for anyone who does not already have the document. */}
      <Alert tone="info">
        <Info className="size-4" aria-hidden="true" />
        <div className="flex flex-wrap items-center gap-x-1.5">
          <span>Need the template?</span>
          <button
            type="button"
            className="font-medium underline underline-offset-2"
            onClick={async () => {
              try {
                // The server names the file, so the version in the filename is
                // the version the parser was written against.
                const download = await downloadNoticeTemplate();
                saveBlob(download.blob, download.filename);
              } catch {
                toast.error("Could not download", "The template could not be fetched.");
              }
            }}
          >
            Download it
          </button>
          <span className="text-xs text-text-muted">
            — fill in every placeholder, then upload it here.
          </span>
        </div>
      </Alert>

      <FileInput
        label="Notice document"
        hint="The filled-in .docx template. Every placeholder must be replaced before uploading."
        accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        maxBytes={MAX_DOCUMENT_BYTES}
        file={file}
        onChange={pick}
        required
      />

      {!report && (
        <Button
          type="button"
          variant="secondary"
          onClick={runCheck}
          disabled={!file || check.isPending}
        >
          {check.isPending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <FileText className="size-4" />
          )}
          Check the document
        </Button>
      )}

      {report && <Report report={report} />}

      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button
          type="button"
          variant="primary"
          onClick={runImport}
          disabled={!report}
          loading={submit.isPending}
          title={report ? undefined : "Check the document first"}
        >
          {report?.replaces_draft ? "Replace the draft notice" : "Create the notice"}
        </Button>
      </DialogFooter>
    </div>
  );
}

/**
 * What the parser understood, shown before anything is written.
 *
 * Ordered by how likely each part is to be wrong, not by how the document is
 * laid out: purposes first, because they are inferred from a table and become
 * rows in a shared register; the text last, because whoever is uploading it has
 * already read it.
 */
function Report({ report }: { report: NoticeDocumentReport }) {
  return (
    <div className="space-y-3">
      <Alert tone="success">
        <CheckCircle2 className="size-4" aria-hidden="true" />
        <span>
          Read {report.purposes.length} purposes and {report.data_categories.length} data
          categories, in {report.language}. Nothing has been written yet.
        </span>
      </Alert>

      {report.warnings.map((warning) => (
        <Alert key={warning} tone="warning">
          <AlertTriangle className="size-4" aria-hidden="true" />
          <span>{warning}</span>
        </Alert>
      ))}

      <div>
        <h4 className="mb-1.5 text-sm font-medium">Purposes</h4>
        <div className="overflow-x-auto">
          <Table>
            <thead>
              <Tr>
                <Th>In document</Th>
                <Th>Name</Th>
                <Th>Data categories</Th>
                <Th>Retention</Th>
                <Th>Consent</Th>
              </Tr>
            </thead>
            <tbody>
              {report.purposes.map((purpose) => (
                <Tr key={purpose.document_id}>
                  <Td>
                    <Mono>{purpose.document_id}</Mono>
                  </Td>
                  <Td className="font-medium">{purpose.name}</Td>
                  <Td className="text-xs text-text-muted">
                    {purpose.data_categories.length} — {purpose.data_categories.join(", ")}
                  </Td>
                  <Td className="whitespace-nowrap text-xs">{purpose.retention_period}</Td>
                  <Td>
                    {/* "Necessary for participation" in the document. Named here
                        the way it reads to the person deciding, not the way the
                        column is headed. */}
                    <Badge tone={purpose.is_mandatory ? "neutral" : "info"}>
                      {purpose.is_mandatory ? "Required" : "Declinable"}
                    </Badge>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </div>
      </div>

      {report.possible_duplicates.length > 0 && (
        <Alert tone="info">
          <Info className="size-4" aria-hidden="true" />
          <div>
            <p className="font-medium">
              {report.possible_duplicates.length} of these read like purposes already in the
              register.
            </p>
            <p className="mt-0.5 text-xs">
              They will still be created as new. Whether two purposes are the same one is the
              DPO&apos;s call, not a text comparison&apos;s — this is so it is a decision
              somebody takes rather than one that happens.
            </p>
            <ul className="mt-1.5 space-y-0.5 text-xs">
              {report.possible_duplicates.map((duplicate) => (
                <li key={duplicate.document_id}>
                  <Mono>{duplicate.document_id}</Mono> resembles{" "}
                  <Mono>{duplicate.resembles}</Mono> ({duplicate.resembles_name})
                </li>
              ))}
            </ul>
          </div>
        </Alert>
      )}

      <details className="rounded-lg border border-border px-3 py-2">
        <summary className="cursor-pointer text-sm font-medium">
          The text a data subject will read ({report.rendered_characters.toLocaleString()}{" "}
          characters)
        </summary>
        <p className="mt-2 whitespace-pre-wrap text-xs text-text-muted">
          {report.rendered_excerpt}…
        </p>
      </details>
    </div>
  );
}
