/**
 * The audit trail.
 *
 * Read-only for everyone, including the DPO reading it. There is no edit control
 * on this page because there is no edit endpoint behind it: the route is not
 * registered, the grant is revoked from the application role, and a database
 * trigger refuses the statement. The Privacy Office is audited by this table, and
 * a DPO who can edit her own audit trail makes it worthless as evidence.
 *
 * "Verify chain" walks the hash chain server-side. Each row carries a digest over
 * its own content and its predecessor's, so editing row N invalidates N and
 * everything after it - the answer is not "something changed" but "the trail is
 * sound up to exactly here".
 */
"use client";

import { CheckCircle2, ShieldAlert, ShieldCheck } from "lucide-react";
import * as React from "react";

import { PageHeader } from "@/components/app-shell";
import { AuditDetailDialog, distinctSentence, EntityRef } from "@/components/audit-detail";
import {
  FilterBar,
  FilterSelect,
  ResourceList,
  useCursorStack,
} from "@/components/resource-list";
import { EmptyRecords } from "@/components/ui/graphics";
import { Alert, Button, Td, Tr } from "@/components/ui/primitives";
import { StatusBadge } from "@/components/ui/status";
import { useAudit, useAuditVerify } from "@/features/audit";
import type { AuditEntry } from "@/types";
import { formatDateTime, humanise } from "@/lib/format";

/** The 22 tables, exactly. `entity_type` is the table name and nothing else -
 *  free text would produce three spellings of the same table within a month. */
const ENTITY_TYPES = [
  "auth_user",
  "person_type_history",
  "processor",
  "data_source",
  "purpose",
  "project",
  "project_status_history",
  "project_approval",
  "project_site",
  "notice",
  "notice_purpose",
  "notice_language",
  "consent_link",
  "consent_artefact",
  "consent_purpose_grant",
  "export_log",
  "export_line",
  "import_batch",
  "collection",
  "data_asset",
  "asset_consent",
  "audit_log",
].map((t) => ({ value: t, label: t }));

export default function AuditPage() {
  const stack = useCursorStack();
  const [entityType, setEntityType] = React.useState("");
  const [open, setOpen] = React.useState<AuditEntry | null>(null);
  const [verifying, setVerifying] = React.useState(false);

  const query = useAudit({
    entity_type: entityType || undefined,
    cursor: stack.cursor,
    limit: 50,
  });
  const verification = useAuditVerify(verifying);

  return (
    <>
      <PageHeader
        title="Audit trail"
        description="Append-only and hash-chained. Nothing here can be edited or deleted by anyone, including the Privacy Office."
        actions={
          <Button
            variant="secondary"
            loading={verification.isFetching}
            onClick={() => setVerifying(true)}
          >
            <ShieldCheck className="size-4" />
            Verify chain
          </Button>
        }
      />

      {verification.data && (
        <Alert
          tone={verification.data.intact ? "success" : "danger"}
          title={verification.data.intact ? "Chain intact" : "Chain broken"}
          className="mb-4"
        >
          <p className="flex items-start gap-2">
            {verification.data.intact ? (
              <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            ) : (
              <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            )}
            <span>{verification.data.message}</span>
          </p>
        </Alert>
      )}

      <FilterBar>
        <FilterSelect
          label="Entity type"
          value={entityType}
          onChange={(v) => {
            setEntityType(v);
            stack.reset();
          }}
          options={ENTITY_TYPES}
          allLabel="All tables"
        />
      </FilterBar>

      <ResourceList<AuditEntry>
        query={query}
        stack={stack}
        caption="Audit entries, most recent first"
        columns={["When", "Event", "Actor", "Subject", "Entity"]}
        keyOf={(e) => e.log_uuid}
        empty={{
          illustration: <EmptyRecords />,
          title: entityType ? "No entries for that table" : "No audit entries",
          description: "Every write to the platform records one entry here.",
        }}
        row={(e) => (
          // The whole row opens the entry. A listing that shows `notice#42` and
          // offers no way to find out which notice is a log, not a trail.
          <Tr
            onClick={() => setOpen(e)}
            className="cursor-pointer"
            tabIndex={0}
            role="button"
            aria-label={`Open ${humanise(e.event_type.replace(/\./g, " "))}`}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                setOpen(e);
              }
            }}
          >
            <Td className="whitespace-nowrap text-text-muted">
              {formatDateTime(e.occurred_at)}
            </Td>
            <Td>
              <span className="font-medium">{humanise(e.event_type.replace(/\./g, " "))}</span>
              {/* Only where it says something the title does not. For an event
                  with no mapped sentence the fallback *is* the title, and
                  printing it twice reads as a rendering bug. */}
              {distinctSentence(e) && (
                <p className="mt-0.5 max-w-md text-xs text-text-subtle">
                  {distinctSentence(e)}
                </p>
              )}
            </Td>
            <Td>
              {/* Actor and subject are frequently different people: when a DCO
                  runs an export the actor is the DCO and the subject is nobody. */}
              {e.actor_name ? (
                <>
                  <span className="text-text-muted">{e.actor_name}</span>
                  {e.actor_role && (
                    <StatusBadge
                      kind="role"
                      value={e.actor_role}
                      dot={false}
                      className="ml-1.5"
                    />
                  )}
                </>
              ) : (
                <span className="text-xs text-text-subtle">system</span>
              )}
            </Td>
            <Td className="text-text-muted">
              {e.subject_name ?? <span className="text-xs text-text-subtle">—</span>}
            </Td>
            <Td className="max-w-xs">
              <EntityRef entry={e} />
            </Td>
          </Tr>
        )}
      />

      <AuditDetailDialog entry={open} onClose={() => setOpen(null)} />
    </>
  );
}
