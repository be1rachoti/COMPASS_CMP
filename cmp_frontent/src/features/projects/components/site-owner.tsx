/**
 * Who is accountable for a site, and the control that changes it.
 *
 * The reason this is worth its own component rather than a dropdown inline: it
 * is the only place project ownership is decided, and the consequence is not
 * obvious from the control. Assigning the *primary* site moves the whole
 * project into somebody else's list — including out of the list of the person
 * doing the assigning, if they are a DCO acting on their own patch.
 *
 * So the component says so before the change and confirms what happened after.
 * A dropdown that silently rehomes a project is a dropdown people learn to
 * distrust.
 */
"use client";

import { ArrowRightLeft, Star, UserRound } from "lucide-react";
import * as React from "react";

import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Alert, Button, Field, Select } from "@/components/ui/primitives";
import { useAssignableDcos } from "@/features/projects/queries";
import { useAssignSiteDco } from "@/features/projects/mutations";
import { useToast } from "@/providers";
import type { SiteWithOwner } from "@/types";

/** The inline display: who owns it, and whether it is the deciding site. */
export function SiteOwner({ site }: { site: SiteWithOwner }) {
  if (!site.dco_name) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-text-subtle">
        <UserRound className="size-3.5" aria-hidden="true" />
        no owner
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-text-muted">
      <UserRound className="size-3.5 shrink-0" aria-hidden="true" />
      {site.dco_name}
      {site.is_primary && (
        <span
          className="inline-flex items-center gap-1 rounded-full bg-accent-subtle px-1.5 py-0.5 text-[11px] font-medium text-accent-text"
          // Explains itself on hover *and* to a screen reader, because "primary"
          // is a term this product invented and nobody arrives knowing it.
          title="This project follows this site's owner"
        >
          <Star className="size-2.5" aria-hidden="true" />
          decides
        </span>
      )}
    </span>
  );
}

/**
 * The reassignment dialog.
 *
 * Restricted to DPO and administrator at the API. The button that opens it is
 * gated the same way — not as a security measure, which it could not be, but so
 * a DCO is not offered a control that would 403.
 */
export function AssignSiteOwnerDialog({
  site,
  onClose,
}: {
  site: SiteWithOwner | null;
  onClose: () => void;
}) {
  if (!site) return null;
  // Keyed on the site, so opening a different one remounts the body and its
  // selection starts from that site's owner. An effect syncing state to the
  // prop would do the same thing one render later, and cascade.
  return <AssignSiteOwnerBody key={site.site_uuid} site={site} onClose={onClose} />;
}

function AssignSiteOwnerBody({
  site,
  onClose,
}: {
  site: SiteWithOwner;
  onClose: () => void;
}) {
  const toast = useToast();
  const dcos = useAssignableDcos();
  const assign = useAssignSiteDco();
  const [selected, setSelected] = React.useState<string>(site.dco_uuid ?? "");

  const changing = selected !== (site.dco_uuid ?? "");
  const chosen = dcos.data?.find((d) => d.uuid === selected);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    try {
      const result = await assign.mutateAsync({
        siteUuid: site.site_uuid,
        dcoUserUuid: selected || null,
      });
      // The server says whether the project actually moved. Repeating its
      // answer rather than inferring one means the toast cannot be wrong about
      // a rule the toast does not implement.
      toast[result.project_moved ? "warning" : "success"](
        result.project_moved ? "Project reassigned" : "Site assigned",
        result.message,
      );
      onClose();
    } catch {
      toast.error("Could not assign this site", "Nothing has been changed.");
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent title={`Who runs ${site.site_label}?`}>
        <form method="post" onSubmit={submit} className="space-y-4" noValidate>
          <Field
            label="Data Collection Owner"
            hint="Sites are how a DCO's workload is defined. Leave unassigned if nobody has taken it on yet."
          >
            {(props) => (
              <Select
                {...props}
                value={selected}
                onChange={(e) => setSelected(e.target.value)}
              >
                <option value="">Nobody — leave unassigned</option>
                {dcos.data?.map((dco) => (
                  <option key={dco.uuid} value={dco.uuid}>
                    {dco.full_name} · {dco.email}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          {/* Said before the change, not after. The whole project moving is a
              larger consequence than the control suggests, and somebody who
              finds out afterwards has already lost the project from their list. */}
          {changing && site.is_primary && (
            <Alert tone="warning" title="This will move the project">
              <span className="inline-flex flex-wrap items-center gap-1.5">
                <ArrowRightLeft className="size-3.5 shrink-0" aria-hidden="true" />
                {site.site_label} is the site this project follows, so the project moves to{" "}
                <strong>{chosen ? chosen.full_name : "nobody"}</strong>
                {chosen ? " and leaves its current owner's list." : "."}
              </span>
            </Alert>
          )}

          {changing && !site.is_primary && (
            <Alert tone="info">
              The project stays with its current owner. This site is not the one it
              follows, so its new owner will be able to see the project and act on this
              site only.
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
