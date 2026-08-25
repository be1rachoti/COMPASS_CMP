/**
 * Purpose registry.
 *
 * A purpose is the unit a data subject actually consents to, so this page shows
 * the four things Rule 3(b) requires and the UI usually hides: the lawful basis,
 * the itemised data categories, the retention period, and what happens when
 * consent lapses.
 *
 * Retirement is offered only when the API says it is possible. A purpose
 * attached to a published notice cannot be retired - retiring it would leave a
 * live notice offering something the registry says no longer exists - and
 * `GET /purposes/{uuid}/usage` is how the UI knows before the user tries.
 */
"use client";

import { CheckCircle2, Pencil, Plus, XCircle } from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { PageHeader } from "@/components/app-shell";
import {
  FilterBar,
  FilterSelect,
  ResourceList,
  SearchBox,
  useCursorStack,
  useFilterParam,
} from "@/components/resource-list";
import { PurposeForm } from "@/components/forms/purpose-form";
import { ConfirmDialog, Dialog, DialogContent } from "@/components/ui/dialog";
import { EmptyRecords } from "@/components/ui/graphics";
import { Badge, Button, Td, Tr } from "@/components/ui/primitives";
import { StatusBadge } from "@/components/ui/status";
import { useActivatePurpose, useEnums, usePurposes, useRetirePurpose } from "@/lib/queries";
import type { Purpose } from "@/lib/types";
import { formatDuration, humanise } from "@/lib/utils";
import { useAuth, useToast } from "@/providers";

function PurposesPageView() {
  const { me } = useAuth();
  const toast = useToast();
  const stack = useCursorStack();
  const [editing, setEditing] = React.useState<Purpose | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [retiring, setRetiring] = React.useState<Purpose | null>(null);

  const activate = useActivatePurpose();
  const retire = useRetirePurpose();
  const [status, setStatus] = useFilterParam("status");
  const [basis, setBasis] = React.useState("");
  const [q, setQ] = React.useState("");

  const { data: enums } = useEnums();
  const query = usePurposes({
    status: status || undefined,
    lawful_basis: basis || undefined,
    q: q || undefined,
    cursor: stack.cursor,
    limit: 25,
  });

  const isDpo = me?.role === "dpo";

  return (
    <>
      <PageHeader
        title="Purposes"
        description="What data may be collected, for what, on which lawful basis, and for how long. A notice offers a data subject a choice per purpose."
        actions={
          isDpo ? (
            <Button variant="primary" onClick={() => setCreating(true)}>
              <Plus className="size-4" />
              New purpose
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
          options={enums?.purpose_status ?? []}
          allLabel="All statuses"
        />
        <FilterSelect
          label="Lawful basis"
          value={basis}
          onChange={(v) => {
            setBasis(v);
            stack.reset();
          }}
          options={enums?.lawful_basis ?? []}
          allLabel="All bases"
        />
      </FilterBar>

      <ResourceList<Purpose>
        query={query}
        stack={stack}
        caption="Purposes in the registry"
        columns={[
          "Purpose",
          "Status",
          "Lawful basis",
          "Data collected",
          "Retention",
          ...(isDpo ? ["Actions"] : []),
        ]}
        keyOf={(p) => p.purpose_uuid}
        empty={{
          illustration: <EmptyRecords />,
          title: status || basis || q ? "No purposes match" : "No purposes yet",
          description: isDpo
            ? "A project cannot publish a notice until at least one active purpose is attached to it."
            : "Purposes are defined by the Privacy Office.",
        }}
        row={(p) => (
          <Tr>
            <Td>
              <Link
                href={`/purposes/${p.purpose_uuid}`}
                className="font-medium text-accent-text hover:underline"
              >
                {p.name}
              </Link>
              <p className="mt-0.5 font-mono text-xs text-text-subtle">{p.purpose_code}</p>
            </Td>
            <Td>
              <StatusBadge kind="purpose" value={p.status} />
            </Td>
            <Td>
              <Badge tone={p.lawful_basis === "consent_s6" ? "accent" : "info"} dot={false}>
                {p.lawful_basis === "consent_s6" ? "Consent s.6" : "Legitimate use s.7"}
              </Badge>
              {p.s7_clause && (
                <p className="mt-0.5 text-xs text-text-subtle">{humanise(p.s7_clause)}</p>
              )}
            </Td>
            <Td className="max-w-xs">
              {/* Rule 3(b)(i): itemised, never a vague category. */}
              <span className="text-xs text-text-muted">
                {p.data_categories.map(humanise).join(", ")}
              </span>
            </Td>
            <Td className="whitespace-nowrap text-text-muted">
              {formatDuration(p.retention_period)}
            </Td>
            {isDpo && (
              <Td>
                <div className="flex gap-1">
                  {/* Editing is permitted only while the purpose is a draft:
                      once it is active a notice may already reference it. */}
                  {p.status === "draft" && (
                    <>
                      <Button variant="ghost" size="sm" onClick={() => setEditing(p)}>
                        <Pencil className="size-4" />
                        Edit
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        loading={activate.isPending}
                        onClick={async () => {
                          try {
                            await activate.mutateAsync(p.purpose_uuid);
                            toast.success("Purpose activated", "Notices can now use it.");
                          } catch (err) {
                            toast.error(
                              "Could not activate",
                              err && typeof err === "object" && "userMessage" in err
                                ? (err as { userMessage: () => string }).userMessage()
                                : "Please try again.",
                            );
                          }
                        }}
                      >
                        <CheckCircle2 className="size-4" />
                        Activate
                      </Button>
                    </>
                  )}
                  {p.status === "active" && (
                    <Button variant="subtle" size="sm" onClick={() => setRetiring(p)}>
                      <XCircle className="size-4" />
                      Retire
                    </Button>
                  )}
                </div>
              </Td>
            )}
          </Tr>
        )}
      />

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent
          title="New purpose"
          description="Rule 3(b): what is collected, what it enables, on what basis, and for how long."
          size="lg"
        >
          <PurposeForm onDone={() => setCreating(false)} />
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(editing)} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent title="Edit purpose" description="Drafts only." size="lg">
          {editing && <PurposeForm purpose={editing} onDone={() => setEditing(null)} />}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={Boolean(retiring)}
        onOpenChange={(o) => !o && setRetiring(null)}
        title={`Retire ${retiring?.name ?? ""}?`}
        confirmLabel="Retire purpose"
        loading={retire.isPending}
        consequence={
          <p>
            It can no longer be attached to a notice. Existing notices that already
            carry it are unaffected — and if any published notice references it,
            the server will refuse, because retiring it would leave a live notice
            offering something the registry says no longer exists.
          </p>
        }
        onConfirm={async () => {
          if (!retiring) return;
          try {
            await retire.mutateAsync(retiring.purpose_uuid);
            toast.success("Purpose retired");
            setRetiring(null);
          } catch (err) {
            toast.error(
              "Could not retire",
              err && typeof err === "object" && "userMessage" in err
                ? (err as { userMessage: () => string }).userMessage()
                : "Please try again.",
            );
          }
        }}
      />
    </>
  );
}

/**
 * `useFilterParam` reads the query string, which forces client rendering, so
 * Next requires a suspense boundary around it. Without one the whole route bails
 * out of prerendering.
 */
export default function PurposesPage() {
  return (
    <React.Suspense fallback={<PageSkeleton />}>
      <PurposesPageView />
    </React.Suspense>
  );
}

function PageSkeleton() {
  return (
    <div className="space-y-4" aria-hidden="true">
      <div className="shimmer h-8 w-64 rounded-lg" />
      <div className="shimmer h-14 rounded-xl" />
      <div className="shimmer h-72 rounded-xl" />
    </div>
  );
}
