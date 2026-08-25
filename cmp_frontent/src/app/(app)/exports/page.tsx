/**
 * The disclosure register.
 *
 * Every export that has left the platform, what it contained, and how many
 * people were in it. `line_count` is the number that makes s.11(1)(b) - "who was
 * my data shared with?" - answerable from the database rather than by parsing an
 * archived CSV that may not have been retained.
 *
 * Download is separate from generate, deliberately. Regenerating in order to
 * re-download would write a second set of `export_line` rows and corrupt the
 * very record this page exists to show.
 */
"use client";

import {
  Download,
} from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { PageHeader } from "@/components/layout/app-shell";
import {
  FilterBar,
  FilterSelect,
  ResourceList,
  useCursorStack,
} from "@/components/data-display/resource-list";
import { EmptyRecords } from "@/components/ui/graphics";
import { Badge, Button, Mono, Td, Tr } from "@/components/ui/primitives";
import { downloadExport, useAllExports } from "@/features/exchange";
import type { ExportListRow } from "@/types";
import { formatDateTime, saveBlob, shortHash } from "@/lib/format";
import { useToast } from "@/providers";

const TYPE_OPTIONS = [
  { value: "collection_pack", label: "Collection pack (no personal data)" },
  { value: "consented_list", label: "Consented list" },
];

export default function ExportsPage() {
  const stack = useCursorStack();
  const toast = useToast();
  const [type, setType] = React.useState("");
  const [busy, setBusy] = React.useState<string | null>(null);

  const query = useAllExports({
    type: type || undefined,
    cursor: stack.cursor,
    limit: 25,
  });

  async function download(uuid: string) {
    setBusy(uuid);
    try {
      const file = await downloadExport(uuid);
      saveBlob(file.blob, file.filename);

      // The staleness header is not decoration: a consented list is true at the
      // moment it was generated, and withdrawals since then are not in it.
      if (file.stalenessWarning && (file.ageDays ?? 0) > 0) {
        toast.warning(`Downloaded — generated ${file.ageDays} day(s) ago`, file.stalenessWarning);
      } else {
        toast.success("Downloaded", file.filename);
      }

      if (file.recordedHash && file.contentHash && file.recordedHash !== file.contentHash) {
        toast.error(
          "Content has changed since generation",
          "The file does not match the hash recorded when this export was created. Report this to the Privacy Office.",
        );
      }
    } catch (err) {
      const message =
        err && typeof err === "object" && "userMessage" in err
          ? (err as { userMessage: () => string }).userMessage()
          : "Download failed.";
      toast.error("Could not download", message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <PageHeader
        title="Exports"
        description="What has left the platform, to which site, and who was in it. Downloads are repeatable and do not create a new disclosure record."
      />

      <FilterBar>
        <FilterSelect
          label="Type"
          value={type}
          onChange={(v) => {
            setType(v);
            stack.reset();
          }}
          options={TYPE_OPTIONS}
          allLabel="All types"
        />
      </FilterBar>

      <ResourceList<ExportListRow>
        query={query}
        stack={stack}
        caption="Exports across all projects in scope"
        columns={["Generated", "Project", "Site", "Type", "Subjects", "SHA-256", "Action"]}
        keyOf={(e) => e.export_uuid}
        empty={{
          illustration: <EmptyRecords />,
          title: type ? "No exports match" : "Nothing has been exported",
          description:
            "Generate an export from a project to hand a collection pack or a consented list to a site.",
        }}
        row={(e) => (
          <Tr>
            <Td className="whitespace-nowrap">
              {formatDateTime(e.exported_at)}
              {e.exported_by_name && (
                <p className="mt-0.5 text-xs text-text-subtle">by {e.exported_by_name}</p>
              )}
            </Td>
            <Td>
              <Link
                href={`/projects/${e.project_uuid}`}
                className="text-text-muted hover:text-text hover:underline"
              >
                {e.project_name}
              </Link>
            </Td>
            <Td className="text-text-muted">{e.site_label ?? "—"}</Td>
            <Td>
              <Badge
                tone={e.export_type === "collection_pack" ? "neutral" : "warning"}
                dot={false}
              >
                {e.export_type === "collection_pack" ? "Collection pack" : "Consented list"}
              </Badge>
            </Td>
            <Td className="tabular text-text-muted">
              {/* Zero for a collection pack - it carries no person rows, which
                  is what makes it safe to email. */}
              {e.line_count ?? 0}
            </Td>
            <Td>
              <Mono>{shortHash(e.file_hash)}</Mono>
            </Td>
            <Td>
              <Button
                variant="secondary"
                size="sm"
                loading={busy === e.export_uuid}
                onClick={() => download(e.export_uuid)}
              >
                <Download className="size-4" />
                Download
              </Button>
            </Td>
          </Tr>
        )}
      />
    </>
  );
}
