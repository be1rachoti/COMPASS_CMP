/**
 * Processor and data-source forms.
 *
 * Both registries carry one field that is doing real compliance work and looks
 * like metadata:
 *
 * - `security_confirmed_at` (Rule 6(1)(f)) is the date the processor's security
 *   safeguards were *confirmed*. It cannot be in the future, because a
 *   confirmation dated next month is a plan, not a confirmation.
 * - `is_authoritative_for` lists the data elements a source owns. Without it a
 *   nightly identity sync will overwrite a value corrected under a rights
 *   request, and the correction quietly stops being true.
 */
"use client";

import * as React from "react";

import { CheckboxGroup, FormError, useApiForm } from "@/components/forms";
import { DialogFooter } from "@/components/ui/dialog";
import { Button, Field, Input, Select } from "@/components/ui/primitives";
import {
  useCreateProcessor,
  useCreateSource,
  useUpdateProcessor,
  useUpdateSource,
} from "@/features/registry";
import { useDataCategories, useEnums } from "@/features/meta";
import { useProcessors } from "@/features/registry";
import type { DataSource, Processor } from "@/types";
import { useAuth, useToast } from "@/providers";
import {
  processorSchema,
  sourceSchema,
} from "@/features/registry/schemas";

/* ================================================================ processor */

export function ProcessorForm({
  processor,
  onDone,
}: {
  processor?: Processor;
  onDone: () => void;
}) {
  const toast = useToast();
  const { data: enums } = useEnums();
  const create = useCreateProcessor();
  const update = useUpdateProcessor(processor?.processor_uuid ?? "");

  const form = useApiForm(processorSchema, {
    legal_name: processor?.legal_name ?? "",
    type: processor?.type ?? "lab",
    contract_ref: processor?.contract_ref ?? "",
    security_confirmed_at: processor?.security_confirmed_at ?? "",
    is_in_house: processor?.is_in_house ?? false,
  });

  const busy = create.isPending || update.isPending;

  const onSubmit = form.submit(async (values) => {
    if (processor) {
      await update.mutateAsync(values);
      toast.success("Processor updated");
    } else {
      await create.mutateAsync(values);
      toast.success(
        "Processor registered",
        values.is_in_house
          ? "Projects naming it come back to their author to assign sources and an RCO."
          : "Projects naming it go to the DCO Admin to be assigned once approved.",
      );
    }
    onDone();
  });

  return (
    <form method="post" onSubmit={onSubmit} noValidate>
      <FormError message={form.formError} />

      <div className="space-y-4">
        <Field
          label="Registered legal name"
          hint="As it appears on the contract, not a trading name."
          error={form.formState.errors.legal_name?.message}
          required
        >
          {(p) => (
            <Input {...p} {...form.register("legal_name")} placeholder="Pune Motion Lab Pvt Ltd" />
          )}
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Type" error={form.formState.errors.type?.message} required>
            {(p) => (
              <Select {...p} {...form.register("type")} disabled={Boolean(processor)}>
                {enums?.processor_type?.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Field
            label="Contract reference"
            error={form.formState.errors.contract_ref?.message}
            required
          >
            {(p) => <Input {...p} {...form.register("contract_ref")} placeholder="CTR-2026-0091" />}
          </Field>
        </div>

        <Field
          label="Security confirmed on"
          hint="Rule 6(1)(f). The date the safeguards were verified — not the date they were promised."
          error={form.formState.errors.security_confirmed_at?.message}
          required
        >
          {(p) => <Input {...p} type="date" {...form.register("security_confirmed_at")} />}
        </Field>

        {/* Its own control rather than a value of `type`, because it answers a
            different question: `type` is what this is, this is whose it is.
            Conflating them would mean a partner lab and an internal one could
            not both be labelled "lab", which is what they both are. */}
        <label className="flex cursor-pointer flex-wrap items-start gap-x-2.5 gap-y-1 rounded-lg border border-border p-3 transition-colors hover:bg-bg-inset has-[:checked]:border-accent-border has-[:checked]:bg-accent-subtle">
          <input
            type="checkbox"
            {...form.register("is_in_house")}
            className="mt-0.5 size-4 shrink-0 rounded border-border-strong accent-[var(--accent)]"
          />
          <span className="text-sm font-medium">We collect this ourselves</span>
          <span className="basis-full text-xs text-text-muted">
            Tick this for an internal team. Projects naming it come back to their author after
            approval, to assign the data sources and an R&amp;D Collection Owner. Left unticked,
            they go to the DCO Admin instead.
          </span>
        </label>
      </div>

      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" loading={busy}>
          {processor ? "Save changes" : "Register processor"}
        </Button>
      </DialogFooter>
    </form>
  );
}

/* =================================================================== source */

export function SourceForm({ source, onDone }: { source?: DataSource; onDone: () => void }) {
  const toast = useToast();
  const { data: enums } = useEnums();
  const { data: categories } = useDataCategories();
  const { me } = useAuth();
  const { data: processors } = useProcessors({ status: "active", limit: 100 });

  // A collection owner registers under their own kind of processor: a DCO is
  // accountable for what a third party collects, an RCO for what the R&D team
  // collects itself. Registering under the other's would create a source they
  // could never be given. The API refuses it, so the option is absent here
  // rather than offered and then rejected.
  //
  // Everybody else is unconstrained — they are registering on somebody's behalf
  // rather than claiming accountability by doing it.
  const ownKind =
    me?.role === "dco" ? false : me?.role === "rco" ? true : null;
  const mustChooseProcessor = ownKind !== null;
  const availableProcessors = (processors?.items ?? []).filter(
    (proc) => ownKind === null || proc.is_in_house === ownKind,
  );

  const create = useCreateSource();
  const update = useUpdateSource(source?.source_uuid ?? "");

  const form = useApiForm(sourceSchema, {
    source_code: source?.source_code ?? "",
    name: source?.name ?? "",
    source_role: source?.source_role ?? "collection",
    exchange_mode: source?.exchange_mode ?? "file_import",
    id_scheme: source?.id_scheme ?? "",
    processor_uuid: source?.processor_uuid ?? "",
    is_authoritative_for: source?.is_authoritative_for ?? [],
  });

  const authoritative = form.watch("is_authoritative_for");
  const busy = create.isPending || update.isPending;

  const onSubmit = form.submit(async (values) => {
    const payload = {
      ...values,
      id_scheme: values.id_scheme || null,
      processor_uuid: values.processor_uuid || null,
    };
    if (source) {
      // The API accepts only name, id_scheme and authority on update - code,
      // role and mode are structural and would invalidate existing imports.
      await update.mutateAsync({
        name: payload.name,
        id_scheme: payload.id_scheme,
        is_authoritative_for: payload.is_authoritative_for,
      });
      toast.success("Source updated");
    } else {
      await create.mutateAsync(payload);
      toast.success("Source registered");
    }
    onDone();
  });

  return (
    <form method="post" onSubmit={onSubmit} noValidate>
      <FormError message={form.formError} />

      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Code"
            error={form.formState.errors.source_code?.message}
            required
          >
            {(p) => (
              <Input
                {...p}
                {...form.register("source_code")}
                placeholder="SRC-PUNE-01"
                disabled={Boolean(source)}
              />
            )}
          </Field>

          <Field label="Name" error={form.formState.errors.name?.message} required>
            {(p) => (
              <Input {...p} {...form.register("name")} placeholder="Pune Motion Lab capture rig" />
            )}
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Role" error={form.formState.errors.source_role?.message} required>
            {(p) => (
              <Select {...p} {...form.register("source_role")} disabled={Boolean(source)}>
                {enums?.source_role?.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Field
            label="Exchange mode"
            error={form.formState.errors.exchange_mode?.message}
            required
          >
            {(p) => (
              <Select {...p} {...form.register("exchange_mode")} disabled={Boolean(source)}>
                {enums?.exchange_mode?.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Identifier scheme"
            hint="How this source names its records. Optional."
          >
            {(p) => <Input {...p} {...form.register("id_scheme")} placeholder="lab-local" />}
          </Field>

          <Field
            label="Operated by"
            hint={
              mustChooseProcessor
                ? "The processor this source belongs to. A source with none can never be deployed on a project."
                : "Leave blank if internal."
            }
            error={form.formState.errors.processor_uuid?.message}
            required={mustChooseProcessor}
          >
            {(p) => (
              <Select {...p} {...form.register("processor_uuid")} disabled={Boolean(source)}>
                {/* A collection owner has to say. Without a processor the source
                    appears under no project's list, so nothing could ever
                    deploy it — an option that silently does nothing. */}
                <option value="">
                  {mustChooseProcessor ? "Choose a processor…" : "Internal"}
                </option>
                {availableProcessors.map((proc) => (
                  <option key={proc.processor_uuid} value={proc.processor_uuid}>
                    {proc.legal_name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>

        <CheckboxGroup
          label="Authoritative for"
          hint="The fields this source owns. Anything not ticked here must never be overwritten by an import from it."
          options={categories?.items ?? []}
          value={authoritative}
          onChange={(next) => form.setValue("is_authoritative_for", next)}
        />
      </div>

      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" loading={busy}>
          {source ? "Save changes" : "Register source"}
        </Button>
      </DialogFooter>
    </form>
  );
}
