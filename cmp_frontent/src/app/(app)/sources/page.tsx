/**
 * Data source registry.
 *
 * `is_authoritative_for` is the column doing real work. It lists the data
 * elements this source owns. Without it a nightly identity sync will overwrite a
 * value that was corrected under a rights request, and nobody will notice - the
 * correction simply stops being true overnight.
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
import { SourceForm } from "@/components/forms/registry-forms";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { EmptyRecords } from "@/components/ui/graphics";
import { Badge, Button, Td, Tr } from "@/components/ui/primitives";
import { StatusBadge } from "@/components/ui/status";
import { useEnums, useSources, useSuspendSource } from "@/lib/queries";
import type { DataSource, Page } from "@/lib/types";
import { humanise } from "@/lib/utils";
import { useAuth, useToast } from "@/providers";

export default function SourcesPage() {
  const { me } = useAuth();
  const toast = useToast();
  const stack = useCursorStack();
  const [status, setStatus] = React.useState("");
  const [q, setQ] = React.useState("");
  const [creating, setCreating] = React.useState(false);
  const [editing, setEditing] = React.useState<DataSource | null>(null);
  const suspend = useSuspendSource();

  const { data: enums } = useEnums();
  const query = useSources({
    status: status || undefined,
    q: q || undefined,
    cursor: stack.cursor,
    limit: 25,
  }) as unknown as {
    data?: Page<DataSource>;
    isLoading: boolean;
    isFetching: boolean;
    error: never;
  };

  const canSuspend = me?.role === "dpo" || me?.role === "admin";

  async function onSuspend(uuid: string, name: string) {
    try {
      await suspend.mutateAsync(uuid);
      toast.success("Source suspended", `Imports from ${name} are now refused.`);
    } catch (err) {
      const message =
        err && typeof err === "object" && "userMessage" in err
          ? (err as { userMessage: () => string }).userMessage()
          : "Could not suspend the source.";
      toast.error("Suspension failed", message);
    }
  }

  return (
    <>
      <PageHeader
        title="Data sources"
        description="Where records come from and which fields each one owns. A source that is not authoritative for a field must never overwrite it."
        actions={
          canSuspend ? (
            <Button variant="primary" onClick={() => setCreating(true)}>
              <Plus className="size-4" />
              Register source
            </Button>
          ) : null
        }
      />

      <FilterBar>
        <SearchBox
          placeholder="Name or code"
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

      <ResourceList<DataSource>
        query={query}
        stack={stack}
        caption="Registered data sources"
        columns={["Source", "Role", "Exchange", "Authoritative for", "Status", "Action"]}
        keyOf={(s) => s.source_uuid}
        empty={{
          illustration: <EmptyRecords />,
          title: status || q ? "No sources match" : "No data sources registered",
          description: "An import must name the source the manifest came from.",
        }}
        row={(s) => (
          <Tr>
            <Td>
              <span className="font-medium">{s.name}</span>
              <p className="mt-0.5 font-mono text-xs text-text-subtle">{s.source_code}</p>
            </Td>
            <Td className="text-text-muted">{humanise(s.source_role)}</Td>
            <Td className="text-text-muted">{humanise(s.exchange_mode)}</Td>
            <Td>
              {s.is_authoritative_for.length === 0 ? (
                <span className="text-xs text-text-subtle">nothing</span>
              ) : (
                <div className="flex flex-wrap gap-1">
                  {s.is_authoritative_for.map((field) => (
                    <Badge key={field} tone="neutral" dot={false}>
                      {humanise(field)}
                    </Badge>
                  ))}
                </div>
              )}
            </Td>
            <Td>
              <StatusBadge kind="record" value={s.status} />
            </Td>
            <Td>
              {canSuspend && (
                <div className="flex gap-1">
                  <Button variant="ghost" size="sm" onClick={() => setEditing(s)}>
                    <Pencil className="size-4" />
                    Edit
                  </Button>
                  {s.status === "active" && (
                    <Button
                      variant="subtle"
                      size="sm"
                      loading={suspend.isPending}
                      onClick={() => onSuspend(s.source_uuid, s.name)}
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
          title="Register a data source"
          description="Declare which fields it owns — anything else it sends must never overwrite ours."
          size="lg"
        >
          <SourceForm onDone={() => setCreating(false)} />
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(editing)} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent title="Edit data source" size="lg">
          {editing && <SourceForm source={editing} onDone={() => setEditing(null)} />}
        </DialogContent>
      </Dialog>
    </>
  );
}
