/**
 * Adding a collection site.
 *
 * A site is one **data source, deployed on this project** — so that is the only
 * thing asked for. Everything else follows from it: the processor, because a
 * source belongs to exactly one; the name, because a site has no name of its
 * own; and who is accountable, because the source carries its owner.
 *
 * This replaced a form with a typed label, a processor dropdown and a source
 * dropdown, which asked the same question three times and let the answers
 * disagree. A site called "Pune lab", operated by one processor, fed by another
 * processor's rig, is three claims and at most one of them is right.
 *
 * The list is filtered to the project's own processors. A source outside them
 * would mean collecting through an organisation the DPO never reviewed, and the
 * API refuses it — so it is absent here rather than offered and then rejected.
 *
 * A site is never deleted, only deactivated: every consent artefact points at
 * the site it was collected at, and a deleted row would orphan the evidence.
 */
"use client";

import { AlertTriangle, Home, Info } from "lucide-react";

import { FormError, useApiForm } from "@/components/forms";
import { DialogFooter } from "@/components/ui/dialog";
import { Alert, Button, Field, Input, Select } from "@/components/ui/primitives";
import { useCreateSite } from "@/features/projects";
import { useProjectProcessors } from "@/features/projects/queries";
import { siteSchema } from "@/features/projects/schemas";
import { useSources } from "@/features/registry";
import { useToast } from "@/providers";

export function SiteForm({
  projectUuid,
  noticePublished,
  onDone,
}: {
  projectUuid: string;
  /** Adding a site after publication is a material change - a new recipient the
   *  published text does not name. */
  noticePublished?: boolean;
  onDone: () => void;
}) {
  const toast = useToast();
  const create = useCreateSite(projectUuid);

  const processors = useProjectProcessors(projectUuid);
  const { data: sources, isLoading: sourcesLoading } = useSources({
    status: "active",
    limit: 100,
  });

  const form = useApiForm(siteSchema, { source_uuid: "", location: "" });

  // Only what this project's processors operate. Computed rather than fetched
  // per processor: a project can name several, and one request that filters is
  // simpler than N that concatenate.
  const named = new Set((processors.data ?? []).map((p) => p.processor_uuid));
  const eligible = (sources?.items ?? []).filter(
    (s) => s.processor_uuid && named.has(s.processor_uuid),
  );

  const chosen = eligible.find((s) => s.source_uuid === form.watch("source_uuid"));

  const onSubmit = form.submit(async (values) => {
    const result = await create.mutateAsync({
      source_uuid: values.source_uuid,
      location: values.location || null,
    });
    toast.success(
      "Collection site added",
      result.material_change
        ? "This adds a recipient the published notice does not name. A new notice version is required before collecting here."
        : "It will appear in the notice's recipient list at publication.",
    );
    onDone();
  });

  return (
    <form method="post" onSubmit={onSubmit} noValidate>
      <FormError message={form.formError} />

      {noticePublished && (
        <Alert tone="warning" className="mb-4">
          <p className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>
              This project&apos;s notice is already published. Adding a site adds a
              recipient that the published text does not name, which is a material
              change requiring a new notice version before collection starts there.
            </span>
          </p>
        </Alert>
      )}

      <div className="space-y-4">
        <Field
          label="Data source"
          hint="What will collect here. Its name becomes the site's, and whoever owns it picks up the work."
          error={form.formState.errors.source_uuid?.message}
          required
        >
          {(p) => (
            <Select {...p} {...form.register("source_uuid")}>
              <option value="">Choose a data source…</option>
              {eligible.map((s) => (
                <option key={s.source_uuid} value={s.source_uuid}>
                  {s.name} · {s.processor_name}
                  {s.owner_name ? ` · ${s.owner_name}` : " · unowned"}
                </option>
              ))}
            </Select>
          )}
        </Field>

        {!sourcesLoading && !processors.isLoading && !eligible.length && (
          <Alert tone="info" title="Nothing registered yet">
            None of this project&rsquo;s processors have a data source registered. A
            collection owner can add one under <strong>Data sources</strong>, and it will
            appear here.
          </Alert>
        )}

        {/* Said before saving, because attaching the first owned source hands
            the project to somebody — and that somebody is not chosen on this
            screen, they come with the rig. */}
        {chosen && (
          <Alert tone="info">
            <p className="flex items-start gap-2">
              {chosen.is_in_house ? (
                <Home className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              ) : (
                <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              )}
              <span>
                {chosen.owner_name ? (
                  <>
                    <strong>{chosen.owner_name}</strong> owns {chosen.source_code} and will
                    pick up this site.
                  </>
                ) : (
                  <>
                    Nobody owns {chosen.source_code} yet, so this site will have no owner
                    until somebody is made accountable for it.
                  </>
                )}
              </span>
            </p>
          </Alert>
        )}

        <Field
          label="Location"
          hint="Optional. The line a data principal reads in the notice's recipient list."
        >
          {(p) => <Input {...p} {...form.register("location")} placeholder="Pune, Maharashtra" />}
        </Field>
      </div>

      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" loading={create.isPending}>
          Add collection site
        </Button>
      </DialogFooter>
    </form>
  );
}
