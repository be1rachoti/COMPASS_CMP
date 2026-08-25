/**
 * Creating and editing a collection site.
 *
 * A site is where consent is actually gathered, so it is never deleted —
 * only deactivated. Every consent artefact points at the site it was
 * collected at, and a deleted row would orphan the evidence.
 */
"use client";

import * as React from "react";
import { AlertTriangle } from "lucide-react";
import { FormError, useApiForm } from "@/components/forms";
import { DialogFooter } from "@/components/ui/dialog";
import { Alert, Button, Field, Input, Select } from "@/components/ui/primitives";
import { useCreateSite } from "@/features/projects";
import { useProcessors, useSources } from "@/features/registry";
import { useToast } from "@/providers";
import { siteSchema } from "@/features/projects/schemas";

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
  const { data: processors } = useProcessors({ status: "active", limit: 100 });

  const form = useApiForm(siteSchema, {
    site_label: "",
    location: "",
    processor_uuid: "",
    source_uuid: "",
  });

  // The cascade. Watching the processor rather than reading it on submit is what
  // makes the second dropdown a consequence of the first instead of an unrelated
  // list of every rig in the registry.
  const processorUuid = form.watch("processor_uuid") ?? "";
  const { data: sources, isFetching: sourcesLoading } = useSources({
    status: "active",
    limit: 100,
    processor: processorUuid || undefined,
  });

  // A source chosen under one processor is not valid under another, and the API
  // refuses the pair. Clearing it here means the user sees that immediately
  // rather than on submit.
  React.useEffect(() => {
    form.setValue("source_uuid", "");
  }, [processorUuid, form]);

  const onSubmit = form.submit(async (values) => {
    const result = await create.mutateAsync({
      site_label: values.site_label,
      location: values.location || null,
      processor_uuid: values.processor_uuid || null,
      source_uuid: values.source_uuid || null,
    });
    toast.success(
      "Site added",
      result.material_change
        ? "This adds a recipient the published notice does not name. A new notice version is required before collecting here."
        : "It will appear in the notice's recipient list at publication.",
    );
    onDone();
  });

  return (
    <form onSubmit={onSubmit} noValidate>
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
          label="Site label"
          hint="Appears in the notice's recipient list, so name it as a data subject would recognise it."
          error={form.formState.errors.site_label?.message}
          required
        >
          {(p) => <Input {...p} {...form.register("site_label")} placeholder="Pune Motion Lab" />}
        </Field>

        <Field label="Location">
          {(p) => (
            <Input {...p} {...form.register("location")} placeholder="Pune, Maharashtra" />
          )}
        </Field>

        <div className="rounded-lg border border-border bg-bg-subtle p-3">
          <p className="text-2xs font-semibold uppercase tracking-wider text-text-subtle">
            Who runs it, and with what
          </p>

          <div className="mt-3 space-y-4">
            <Field
              label="Processor"
              hint="The organisation operating this site. Leave blank if it is run internally."
            >
              {(p) => (
                <Select {...p} {...form.register("processor_uuid")}>
                  <option value="">Operated internally</option>
                  {processors?.items.map((proc) => (
                    <option key={proc.processor_uuid} value={proc.processor_uuid}>
                      {proc.legal_name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>

            <Field
              label="Data source"
              hint={
                processorUuid
                  ? "The rig that will report from this site. Narrowed to what this processor operates."
                  : "Pick a processor first — the list narrows to what they actually run."
              }
              error={form.formState.errors.source_uuid?.message}
            >
              {(p) => (
                <Select
                  {...p}
                  {...form.register("source_uuid")}
                  disabled={!processorUuid || sourcesLoading}
                >
                  <option value="">
                    {!processorUuid
                      ? "Choose a processor first"
                      : sourcesLoading
                        ? "Loading…"
                        : (sources?.items.length ?? 0) === 0
                          ? "This processor has no active source registered"
                          : "Not decided yet"}
                  </option>
                  {sources?.items.map((src) => (
                    <option key={src.source_uuid} value={src.source_uuid}>
                      {src.name} ({src.source_code})
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
        </div>
      </div>

      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" loading={create.isPending}>
          Add site
        </Button>
      </DialogFooter>
    </form>
  );
}
