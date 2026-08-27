/**
 * What stands at a site, who that makes accountable, and the control that
 * changes it.
 *
 * The control picks a **data source**, not a person, and that is the whole
 * design. A source carries its own owner, so choosing CIT is choosing whoever
 * runs CIT — one answer to "who is accountable for CIT", recorded once, rather
 * than one per project that used it. When those were separate fields the same
 * rig could be recorded under three different owners on three projects and
 * nothing noticed.
 *
 * It is worth its own component rather than a dropdown inline because the
 * consequence is not obvious from the control. Attaching a source to the
 * *primary* site moves the whole project into somebody else's list — including
 * out of the list of the person doing it, if they own the source coming off.
 * So the component says so before the change and confirms what happened after.
 * A dropdown that silently rehomes a project is a dropdown people learn to
 * distrust.
 */
"use client";

import { ArrowRightLeft, Home, Star, UserRound } from "lucide-react";
import * as React from "react";

import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Alert, Button, Field, Select } from "@/components/ui/primitives";
import { useAssignSiteSource } from "@/features/projects/mutations";
import { useProjectProcessors } from "@/features/projects/queries";
import { useSources } from "@/features/registry";
import { useToast } from "@/providers";
import type { SiteWithOwner, Uuid } from "@/types";

/** The inline display: what stands here, who owns it, and whether it decides. */
export function SiteOwner({ site }: { site: SiteWithOwner }) {
  if (!site.source_uuid) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-text-subtle">
        <UserRound className="size-3.5" aria-hidden="true" />
        no data source attached
      </span>
    );
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-1.5 text-xs text-text-muted">
      <UserRound className="size-3.5 shrink-0" aria-hidden="true" />
      {/* The source is named as well as the person. "Arun Shetty" alone does not
          say *why* he is accountable here, and the why is the thing somebody
          checks when it looks wrong. */}
      {site.source_name ?? site.source_code}
      {site.dco_name ? (
        <>
          <span aria-hidden="true">·</span>
          {site.dco_name}
        </>
      ) : (
        <span className="text-text-subtle">· nobody owns this source yet</span>
      )}
      {site.is_in_house && (
        <span
          className="inline-flex items-center gap-1 text-[11px] text-text-subtle"
          title="Collected in-house, so an R&D Collection Owner is accountable"
        >
          <Home className="size-2.5" aria-hidden="true" />
          in-house
        </span>
      )}
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
 * The attachment dialog.
 *
 * Restricted at the API to the DPO, an administrator, a DCO Admin and the R&D
 * owner. The button that opens it is gated the same way — not as a security
 * measure, which it could not be, but so nobody is offered a control that would
 * 403.
 */
export function AssignSiteOwnerDialog({
  site,
  projectUuid,
  onClose,
}: {
  site: SiteWithOwner | null;
  projectUuid: Uuid;
  onClose: () => void;
}) {
  if (!site) return null;
  // Keyed on the site, so opening a different one remounts the body and its
  // selection starts from that site's source. An effect syncing state to the
  // prop would do the same thing one render later, and cascade.
  return (
    <AssignSiteOwnerBody
      key={site.site_uuid}
      site={site}
      projectUuid={projectUuid}
      onClose={onClose}
    />
  );
}

function AssignSiteOwnerBody({
  site,
  projectUuid,
  onClose,
}: {
  site: SiteWithOwner;
  projectUuid: Uuid;
  onClose: () => void;
}) {
  const toast = useToast();
  const processors = useProjectProcessors(projectUuid);
  const sources = useSources({ status: "active" });
  const assign = useAssignSiteSource();
  const [selected, setSelected] = React.useState<string>(site.source_uuid ?? "");

  // Only sources under a processor this project named. Anything else would mean
  // collecting through an organisation the DPO did not approve, and the server
  // refuses it — so offering it would produce an error where an absence is
  // clearer.
  const named = new Set((processors.data ?? []).map((p) => p.processor_uuid));
  const eligible = (sources.data?.items ?? []).filter(
    (s) => s.processor_uuid && named.has(s.processor_uuid),
  );

  const changing = selected !== (site.source_uuid ?? "");
  const chosen = eligible.find((s) => s.source_uuid === selected);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    try {
      const result = await assign.mutateAsync({
        siteUuid: site.site_uuid,
        sourceUuid: selected || null,
      });
      // The server says whether the project actually moved. Repeating its
      // answer rather than inferring one means the toast cannot be wrong about
      // a rule the toast does not implement.
      toast[result.project_moved ? "warning" : "success"](
        result.project_moved ? "Project reassigned" : "Source attached",
        result.message,
      );
      onClose();
    } catch {
      toast.error("Could not attach this source", "Nothing has been changed.");
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent title={`What collects at ${site.site_label}?`}>
        <form method="post" onSubmit={submit} className="space-y-4" noValidate>
          <Field
            label="Data source"
            hint="Whoever owns the source becomes accountable for this site. Leave unattached if nothing has been decided yet."
          >
            {(props) => (
              <Select {...props} value={selected} onChange={(e) => setSelected(e.target.value)}>
                <option value="">Nothing — leave unattached</option>
                {eligible.map((source) => (
                  <option key={source.source_uuid} value={source.source_uuid}>
                    {source.name} ({source.source_code})
                    {source.owner_name ? ` · ${source.owner_name}` : " · unowned"}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          {!processors.isLoading && !eligible.length && (
            <Alert tone="info">
              None of this project&rsquo;s processors have a data source registered yet. Add one
              under <strong>Sources</strong>, and it will appear here.
            </Alert>
          )}

          {/* An unowned source is attachable and is not an error — a rig can be
              registered before anyone has taken it on. But it will not route the
              project, and somebody expecting it to should find that out here
              rather than by watching a queue stay empty. */}
          {chosen && !chosen.owner_name && (
            <Alert tone="warning" title="Nobody owns this source yet">
              You can attach it, but the project will stay unassigned until somebody is made
              accountable for {chosen.source_code}.
            </Alert>
          )}

          {/* Said before the change, not after. The whole project moving is a
              larger consequence than the control suggests, and somebody who
              finds out afterwards has already lost the project from their list. */}
          {changing && site.is_primary && (
            <Alert tone="warning" title="This will move the project">
              <span className="inline-flex flex-wrap items-center gap-1.5">
                <ArrowRightLeft className="size-3.5 shrink-0" aria-hidden="true" />
                {site.site_label} is the site this project follows, so the project moves to{" "}
                <strong>{chosen?.owner_name ?? "nobody"}</strong>
                {chosen?.owner_name ? " and leaves its current owner's list." : "."}
              </span>
            </Alert>
          )}

          {changing && !site.is_primary && (
            <Alert tone="info">
              The project stays with its current owner. This site is not the one it follows, so
              the new source&rsquo;s owner will be able to see the project and act on this site
              only.
            </Alert>
          )}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={assign.isPending} disabled={!changing}>
              {selected ? "Attach" : "Detach"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
