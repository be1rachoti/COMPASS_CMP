/**
 * Security and legal approvals.
 *
 * INV-8: proof is mandatory. An approval row without a proof file does not
 * unlock the transition to pending_approval, so the SHA-256 of the uploaded
 * document travels with every row here - it is the evidence, not decoration, and
 * showing it lets somebody check that the file they have matches the one on
 * record.
 */
"use client";

import {
  Download,
} from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { PageHeader } from "@/components/layout/app-shell";
import { ResourceList, useCursorStack } from "@/components/data-display/resource-list";
import { EmptyQueue } from "@/components/ui/graphics";
import { Badge, Button, Mono, Td, Tr } from "@/components/ui/primitives";
import { StatusBadge } from "@/components/ui/status";
import { downloadApprovalProof, useAllApprovals } from "@/features/projects";
import type { ApprovalListRow } from "@/types";
import { formatDate, formatDateTime, humanise, saveBlob, shortHash } from "@/lib/format";
import { useToast } from "@/providers";

export default function ApprovalsPage() {
  const stack = useCursorStack();
  const toast = useToast();
  const [busy, setBusy] = React.useState<string | null>(null);

  const query = useAllApprovals({ cursor: stack.cursor, limit: 25 });

  async function downloadProof(uuid: string, reference: string, recorded: string) {
    setBusy(uuid);
    try {
      const file = await downloadApprovalProof(uuid);
      saveBlob(file.blob, file.filename || `approval-${reference}`);

      // The served hash is compared against the one recorded at upload. A
      // mismatch means the stored file is not the file that was approved.
      if (file.contentHash && file.contentHash !== recorded) {
        toast.error(
          "Proof does not match its recorded hash",
          "The stored file differs from what was uploaded. Report this to the Privacy Office.",
        );
      } else {
        toast.success("Proof downloaded", "Hash matches the record.");
      }
    } catch (err) {
      const message =
        err && typeof err === "object" && "userMessage" in err
          ? (err as { userMessage: () => string }).userMessage()
          : "Download failed.";
      toast.error("Could not download the proof", message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <PageHeader
        title="Approvals"
        description="Security and legal sign-off, each with the proof document that makes it real. A project cannot reach pending approval without one."
      />

      <ResourceList<ApprovalListRow>
        query={query}
        stack={stack}
        caption="Approvals across all projects in scope"
        columns={["Reference", "Project", "Type", "Approved on", "Proof SHA-256", "Uploaded", ""]}
        keyOf={(a) => a.approval_uuid}
        empty={{
          illustration: <EmptyQueue />,
          title: "No approvals yet",
          description:
            "Upload a security approval with its proof file to move a project from under process to pending approval.",
        }}
        row={(a) => (
          <Tr>
            <Td className="font-mono text-xs font-medium">{a.reference_no}</Td>
            <Td>
              <Link
                href={`/projects/${a.project_uuid}`}
                className="text-text-muted hover:text-text hover:underline"
              >
                {a.project_name}
              </Link>
              <div className="mt-0.5">
                <StatusBadge kind="project" value={a.project_status} dot={false} />
              </div>
            </Td>
            <Td>
              <Badge tone="accent" dot={false}>
                {humanise(a.approval_type)}
              </Badge>
            </Td>
            <Td className="whitespace-nowrap text-text-muted">
              {formatDate(a.approved_on)}
            </Td>
            <Td>
              <Mono>{shortHash(a.proof_file_hash)}</Mono>
            </Td>
            <Td className="whitespace-nowrap text-text-muted">
              {formatDateTime(a.uploaded_at)}
              <p className="mt-0.5 text-xs text-text-subtle">{a.uploaded_by_name}</p>
            </Td>
            <Td>
              <Button
                variant="secondary"
                size="sm"
                loading={busy === a.approval_uuid}
                onClick={() =>
                  downloadProof(a.approval_uuid, a.reference_no, a.proof_file_hash)
                }
              >
                <Download className="size-4" />
                Proof
              </Button>
            </Td>
          </Tr>
        )}
      />
    </>
  );
}
