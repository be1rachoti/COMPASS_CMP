/**
 * Naming who runs one site, when it is not the source's owner.
 *
 * Attaching a data source already picks the owner, and that is right almost
 * every time. This is for when it is not: cover, a handover, a partner who
 * insists on a named contact. Several sites on one project can each name a
 * different person.
 *
 * **The thing this screen has to make unmissable is what it does *not* do.**
 * There is a second control one page away — assigning the source itself — which
 * looks like the same decision and is not: that one moves the rig, and every
 * other project collecting from it moves too. Somebody reaching for the wrong
 * one would reassign three studies while believing they had reassigned one, and
 * would have no way of noticing. So the copy says plainly that the source is
 * unchanged, and the dialog names the owner being overridden rather than
 * leaving the reader to work out what they are replacing.
 */
"use client";

import { Info, UserRoundCog } from "lucide-react";
import * as React from "react";

import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Alert, Button, Field, Select } from "@/components/ui/primitives";
import { useAssignSiteOwner } from "@/features/projects/mutations";
import { useCollectionOwners } from "@/features/projects/queries";
import { formatDate } from "@/lib/format";
import { useToast } from "@/providers";
import type { SiteWithOwner } from "@/types";

/** The marker on a site whose owner is a named exception. */
export function OverrideBadge({ site }: { site: SiteWithOwner }) {
  if (!site.owner_overridden) return null;
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full border border-accent-border bg-accent-subtle px-2 py-0.5 text-2xs font-medium text-accent-text"
      title={
        [
          site.source_owner_name
            ? `Runs this site instead of ${site.source_owner_name}, who owns the data source`
            : "Named for this site directly",
          site.override_by_name ? `Set by ${site.override_by_name}` : null,
          site.override_at ? formatDate(site.override_at) : null,
        ]
          .filter(Boolean)
          .join(" · ")
      }
    >
      <UserRoundCog className="size-2.5" aria-hidden="true" />
      named here
    </span>
  );
}

export function AssignSiteDcoDialog({
  site,
  onClose,
}: {
  site: SiteWithOwner | null;
  onClose: () => void;
}) {
  if (!site) return null;
  return <AssignSiteDcoBody key={site.site_uuid} site={site} onClose={onClose} />;
}

function AssignSiteDcoBody({ site, onClose }: { site: SiteWithOwner; onClose: () => void }) {
  const toast = useToast();
  const owners = useCollectionOwners();
  const assign = useAssignSiteOwner();

  // Empty means "no exception", which is not the same as "nobody": clearing it
  // hands the site back to whoever owns the source.
  const [selected, setSelected] = React.useState<string>(
    site.owner_overridden ? (site.dco_uuid ?? "") : "",
  );

  // In-house collection is an RCO's, a third party's is a DCO's — the same rule
  // the source itself is held to, so the wrong choice is absent rather than
  // offered and then refused.
  const wanted = site.is_in_house ? "rco" : "dco";
  const eligible = (owners.data ?? []).filter((o) => o.role === wanted);

  const changing = selected !== (site.owner_overridden ? (site.dco_uuid ?? "") : "");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    try {
      const result = await assign.mutateAsync({
        siteUuid: site.site_uuid,
        ownerUserUuid: selected || null,
      });
      toast[result.project_moved ? "warning" : "success"](
        selected ? "Site owner named" : "Back to the source's owner",
        result.project_moved
          ? "This project has moved. The data source is unchanged, so no other project has."
          : "The project's owner is unchanged.",
      );
      onClose();
    } catch (err) {
      toast.error(
        "Could not change the owner",
        err && typeof err === "object" && "userMessage" in err
          ? (err as { userMessage: () => string }).userMessage()
          : "Nothing has been changed.",
      );
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        title={`Who runs ${site.site_label}?`}
        description="Only on this project. The data source keeps its own owner."
      >
        <form method="post" onSubmit={submit} className="space-y-4" noValidate>
          {!site.source_uuid ? (
            // Nothing to override yet. Attaching a source picks an owner on its
            // own, which is the operation they actually want.
            <Alert tone="info" title="No data source attached">
              Attach the data source that collects here first — that picks the owner
              automatically, and this screen is only for when that answer is wrong.
            </Alert>
          ) : (
            <>
              <Alert tone="info">
                <p className="flex items-start gap-2">
                  <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                  <span>
                    {site.source_owner_name ? (
                      <>
                        <strong>{site.source_owner_name}</strong> owns{" "}
                        {site.source_code ?? "this data source"} and runs this site by
                        default.
                      </>
                    ) : (
                      <>Nobody owns {site.source_code ?? "this data source"} yet.</>
                    )}{" "}
                    Naming somebody here changes this site on this project only — the data
                    source keeps its owner, and every other project collecting from it is
                    untouched.
                  </span>
                </p>
              </Alert>

              <Field
                label={site.is_in_house ? "R&D Collection Owner" : "Data Collection Owner"}
                hint="They will be able to open this project and work this site, without the data source being reassigned to them."
              >
                {(props) => (
                  <Select
                    {...props}
                    value={selected}
                    onChange={(e) => setSelected(e.target.value)}
                  >
                    <option value="">
                      {site.source_owner_name
                        ? `No exception — ${site.source_owner_name} runs it`
                        : "No exception — whoever owns the data source"}
                    </option>
                    {eligible.map((owner) => (
                      <option key={owner.uuid} value={owner.uuid}>
                        {owner.full_name} · {owner.email}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>

              {changing && site.is_primary && (
                <Alert tone="warning" title="This will move the project">
                  {site.site_label} is the site this project follows, so the project moves
                  into the new owner&rsquo;s list and leaves the current one&rsquo;s.
                </Alert>
              )}

              {changing && !site.is_primary && (
                <Alert tone="info">
                  The project stays with its current owner. This site is not the one it
                  follows, so whoever you name will be able to see the project and work
                  this site only.
                </Alert>
              )}
            </>
          )}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              loading={assign.isPending}
              disabled={!changing || !site.source_uuid}
            >
              {selected ? "Name them" : "Clear the exception"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
