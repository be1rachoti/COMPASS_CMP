/**
 * Making somebody accountable for a data source.
 *
 * This is the only place in the product where a person is named as accountable
 * for collection. Everywhere else — registering a site, routing an approved
 * project — picks a *source*, and the owner comes with it. So there is one
 * answer to "who is accountable for CIT", recorded once, instead of one per
 * project that happened to use it and three that could disagree.
 *
 * The consequence runs the other way too, and it is why this needs a dialog
 * rather than an inline dropdown: reassigning a rig used by three studies moves
 * three studies. The count comes back from the server and is repeated to the
 * person who did it, because a change with that reach should not be something
 * you find out about later.
 */
"use client";

import { Home, UserRound } from "lucide-react";
import * as React from "react";

import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Alert, Button, Field, Select } from "@/components/ui/primitives";
import { useCollectionOwners } from "@/features/projects/queries";
import { useAssignSourceOwner } from "@/features/registry/mutations";
import { useToast } from "@/providers";
import type { DataSource } from "@/types";

/** The inline display: who is accountable, or that nobody is. */
export function SourceOwner({ source }: { source: DataSource }) {
  if (!source.owner_name) {
    return (
      // Not an error. A rig can be registered before anyone has taken it on,
      // and this is the state the DCO Admin's queue is made of — so it reads as
      // outstanding work rather than as a fault.
      <span className="inline-flex items-center gap-1.5 text-xs text-text-subtle">
        <UserRound className="size-3.5" aria-hidden="true" />
        nobody yet
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-text-muted">
      <UserRound className="size-3.5 shrink-0" aria-hidden="true" />
      {source.owner_name}
      {source.owner_role === "rco" && (
        <span
          className="inline-flex items-center gap-1 text-[11px] text-text-subtle"
          title="An R&D Collection Owner: accountable for collection the R&D team does itself"
        >
          <Home className="size-2.5" aria-hidden="true" />
          RCO
        </span>
      )}
    </span>
  );
}

export function AssignSourceOwnerDialog({
  source,
  onClose,
}: {
  source: DataSource | null;
  onClose: () => void;
}) {
  if (!source) return null;
  // Keyed on the source, so opening a different one remounts the body and its
  // selection starts from that source's owner.
  return <AssignSourceOwnerBody key={source.source_uuid} source={source} onClose={onClose} />;
}

function AssignSourceOwnerBody({
  source,
  onClose,
}: {
  source: DataSource;
  onClose: () => void;
}) {
  const toast = useToast();
  const owners = useCollectionOwners();
  const assign = useAssignSourceOwner();
  const [selected, setSelected] = React.useState<string>(source.owner_user_uuid ?? "");

  // An in-house source needs an RCO and a third party's needs a DCO. The server
  // enforces it; filtering here means the wrong choice is not offered rather
  // than offered and then refused.
  const wanted = source.is_in_house ? "rco" : "dco";
  const eligible = (owners.data ?? []).filter((o) => o.role === wanted);

  const changing = selected !== (source.owner_user_uuid ?? "");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    try {
      const result = await assign.mutateAsync({
        sourceUuid: source.source_uuid,
        ownerUserUuid: selected || null,
      });
      const moved = result.projects_moved;
      toast[moved > 0 ? "warning" : "success"](
        selected ? "Source assigned" : "Source unassigned",
        moved > 0
          ? `${moved} project${moved === 1 ? "" : "s"} moved with it.`
          : "No project is currently collecting from it.",
      );
      onClose();
    } catch {
      toast.error("Could not assign this source", "Nothing has been changed.");
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        title={`Who is accountable for ${source.name}?`}
        description="Every project collecting from this source follows whoever owns it."
      >
        <form method="post" onSubmit={submit} className="space-y-4" noValidate>
          <Field
            label={source.is_in_house ? "R&D Collection Owner" : "Data Collection Owner"}
            hint={
              source.is_in_house
                ? "Collection from this source is in-house, so an RCO is accountable for it."
                : "Collection from this source is by a third party, so a DCO is accountable for it."
            }
          >
            {(props) => (
              <Select {...props} value={selected} onChange={(e) => setSelected(e.target.value)}>
                <option value="">Nobody — leave unassigned</option>
                {eligible.map((owner) => (
                  <option key={owner.uuid} value={owner.uuid}>
                    {owner.full_name} · {owner.email}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          {!owners.isLoading && !eligible.length && (
            <Alert tone="info">
              No active {source.is_in_house ? "R&D Collection Owners" : "Data Collection Owners"}{" "}
              exist yet. An administrator creates them from <strong>Users</strong>, and can
              attach sources at the same time.
            </Alert>
          )}

          {/* Said before the change. Un-assigning is a real operation — somebody
              leaves and their sources sit unowned until they are picked up — but
              it stops every project using this source from having anybody
              answerable for it, and that is worth stating out loud. */}
          {changing && !selected && (
            <Alert tone="warning" title="Nobody will be accountable">
              Projects collecting from {source.source_code} will have no owner until somebody
              takes it on.
            </Alert>
          )}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={assign.isPending} disabled={!changing}>
              {selected ? "Assign" : "Unassign"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
