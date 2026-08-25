/**
 * Processor registry.
 *
 * `security_confirmed_at` is the column that carries the obligation: Rule 6(1)(f)
 * requires reasonable security safeguards to have been confirmed, and the date
 * is the evidence that it happened rather than being planned.
 *
 * Processors are suspended, never deleted. Deleting one orphans every collection
 * that named it, and "who processed this?" stops having an answer.
 */
"use client";

import { Ban, Pencil, Plus } from "lucide-react";
import * as React from "react";

import { PageHeader } from "@/components/app-shell";
import {
  FilterBar,
  FilterSelect,
  ResourceList,
  SearchBox,
  useCursorStack,
} from "@/components/resource-list";
import { ProcessorForm } from "@/components/forms/registry-forms";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { EmptyRecords } from "@/components/ui/graphics";
import { Button, Td, Tr } from "@/components/ui/primitives";
import { StatusBadge } from "@/components/ui/status";
import { useEnums, useProcessors, useSuspendProcessor } from "@/lib/queries";
import type { Processor } from "@/lib/types";
import { formatDate, humanise } from "@/lib/utils";
import { useAuth, useToast } from "@/providers";

export default function ProcessorsPage() {
  const { me } = useAuth();
  const toast = useToast();
  const stack = useCursorStack();
  const [status, setStatus] = React.useState("");
  const [q, setQ] = React.useState("");
  const [creating, setCreating] = React.useState(false);
  const [editing, setEditing] = React.useState<Processor | null>(null);
  const suspend = useSuspendProcessor();

  const { data: enums } = useEnums();
  const query = useProcessors({
    status: status || undefined,
    q: q || undefined,
    cursor: stack.cursor,
    limit: 25,
  });

  const canSuspend = me?.role === "dpo" || me?.role === "admin";

  async function onSuspend(uuid: string, name: string) {
    try {
      await suspend.mutateAsync(uuid);
      toast.success("Processor suspended", `${name} can no longer be assigned to a site.`);
    } catch (err) {
      const message =
        err && typeof err === "object" && "userMessage" in err
          ? (err as { userMessage: () => string }).userMessage()
          : "Could not suspend the processor.";
      toast.error("Suspension failed", message);
    }
  }

  return (
    <>
      <PageHeader
        title="Processors"
        description="Third parties that process personal data on our behalf. Each needs a contract reference and a confirmed security assessment before it can operate a site."
        actions={
          canSuspend ? (
            <Button variant="primary" onClick={() => setCreating(true)}>
              <Plus className="size-4" />
              Register processor
            </Button>
          ) : null
        }
      />

      <FilterBar>
        <SearchBox
          placeholder="Legal name or contract"
          onSubmit={(term) => {
            setQ(term);
            stack.reset();
          }}
        />
        <FilterSelect
          label="Status"
          value={status}
          onChange={(v) => {
            setStatus(v);
            stack.reset();
          }}
          options={enums?.record_status ?? []}
          allLabel="All statuses"
        />
      </FilterBar>

      <ResourceList<Processor>
        query={query}
        stack={stack}
        caption="Registered processors"
        columns={["Legal name", "Type", "Contract", "Security confirmed", "Status", "Action"]}
        keyOf={(p) => p.processor_uuid}
        empty={{
          illustration: <EmptyRecords />,
          title: status || q ? "No processors match" : "No processors registered",
          description:
            "A site operated by a third party must name the processor running it.",
        }}
        row={(p) => (
          <Tr>
            <Td className="font-medium">{p.legal_name}</Td>
            <Td className="text-text-muted">{humanise(p.type)}</Td>
            <Td className="font-mono text-xs text-text-muted">{p.contract_ref}</Td>
            <Td className="whitespace-nowrap text-text-muted">
              {formatDate(p.security_confirmed_at)}
            </Td>
            <Td>
              <StatusBadge kind="record" value={p.status} />
            </Td>
            <Td>
              {canSuspend && (
                <div className="flex gap-1">
                  <Button variant="ghost" size="sm" onClick={() => setEditing(p)}>
                    <Pencil className="size-4" />
                    Edit
                  </Button>
                  {p.status === "active" && (
                    <Button
                      variant="subtle"
                      size="sm"
                      loading={suspend.isPending}
                      onClick={() => onSuspend(p.processor_uuid, p.legal_name)}
                    >
                      <Ban className="size-4" />
                      Suspend
                    </Button>
                  )}
                </div>
              )}
            </Td>
          </Tr>
        )}
      />

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent
          title="Register a processor"
          description="Rule 6(1)(f): the security confirmation date is evidence, not paperwork."
        >
          <ProcessorForm onDone={() => setCreating(false)} />
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(editing)} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent title="Edit processor">
          {editing && <ProcessorForm processor={editing} onDone={() => setEditing(null)} />}
        </DialogContent>
      </Dialog>
    </>
  );
}
