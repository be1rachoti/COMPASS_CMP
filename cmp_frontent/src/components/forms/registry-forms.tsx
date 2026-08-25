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
import { z } from "zod";

import { CheckboxGroup, FormError, useApiForm } from "@/components/forms/form";
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
import { useToast } from "@/providers";

/* ================================================================ processor */

const processorSchema = z.object({
  legal_name: z.string().min(1, "The registered legal name is required").max(255),
  type: z.string().min(1, "Choose a type"),
  contract_ref: z.string().min(1, "A contract reference is required").max(120),
  security_confirmed_at: z
    .string()
    .min(1, "Record the date security was confirmed")
    .refine((v) => new Date(v) <= new Date(), {
      message: "A confirmation cannot be dated in the future",
    }),
});

type ProcessorValues = z.infer<typeof processorSchema>;

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

  const form = useApiForm<ProcessorValues>(processorSchema, {
    legal_name: processor?.legal_name ?? "",
    type: processor?.type ?? "lab",
    contract_ref: processor?.contract_ref ?? "",
    security_confirmed_at: processor?.security_confirmed_at ?? "",
  });

  const busy = create.isPending || update.isPending;

  const onSubmit = form.submit(async (values) => {
    if (processor) {
      await update.mutateAsync(values);
      toast.success("Processor updated");
    } else {
      await create.mutateAsync(values);
      toast.success("Processor registered", "It can now be assigned to a collection site.");
    }
    onDone();
  });

  return (
    <form onSubmit={onSubmit} noValidate>
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

const sourceSchema = z.object({
  source_code: z
    .string()
    .min(1, "A code is required")
    .max(60)
    .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, "Letters, digits, dot, dash and underscore only"),
  name: z.string().min(1, "A name is required").max(200),
  source_role: z.string().min(1, "Choose a role"),
  exchange_mode: z.string().min(1, "Choose an exchange mode"),
  id_scheme: z.string().max(120).optional().nullable(),
  processor_uuid: z.string().optional().nullable(),
  is_authoritative_for: z.array(z.string()),
});

type SourceValues = z.infer<typeof sourceSchema>;

export function SourceForm({ source, onDone }: { source?: DataSource; onDone: () => void }) {
  const toast = useToast();
  const { data: enums } = useEnums();
  const { data: categories } = useDataCategories();
  const { data: processors } = useProcessors({ status: "active", limit: 100 });

  const create = useCreateSource();
  const update = useUpdateSource(source?.source_uuid ?? "");

  const form = useApiForm<SourceValues>(sourceSchema, {
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
    <form onSubmit={onSubmit} noValidate>
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

          <Field label="Operated by" hint="Leave blank if internal.">
            {(p) => (
              <Select {...p} {...form.register("processor_uuid")} disabled={Boolean(source)}>
                <option value="">Internal</option>
                {processors?.items.map((proc) => (
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
