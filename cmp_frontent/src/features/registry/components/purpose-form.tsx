/**
 * Create or edit a purpose.
 *
 * The form is shaped by Rule 3(b): a purpose has to say what data is collected
 * (itemised), what the data enables, on what lawful basis, and for how long. So
 * those are required fields here rather than optional metadata — a purpose
 * missing any of them cannot lawfully appear on a notice, and letting someone
 * save one just moves the failure to publication day.
 *
 * Two rules the server also enforces, mirrored here so the user gets them at the
 * field rather than as a 422:
 *
 * - An s.7 purpose must name the clause it relies on; an s.6 consent purpose
 *   must not carry one.
 * - `data_categories` must be non-empty. (The database CHECK for this was
 *   originally written with `array_length`, which returns NULL on an empty array
 *   and silently admitted it — see migration 0004.)
 */
"use client";

import * as React from "react";
import { z } from "zod";

import { CheckboxGroup, FormError, useApiForm } from "@/components/forms";
import { Button, Field, Input, Select, Textarea } from "@/components/ui/primitives";
import { DialogFooter } from "@/components/ui/dialog";
import { useDataCategories, useEnums } from "@/features/meta";
import { type PurposeInput, useCreatePurpose, useUpdatePurpose } from "@/features/registry";
import type { Purpose } from "@/types";
import { useToast } from "@/providers";

const schema = z
  .object({
    purpose_code: z
      .string()
      .min(1, "A code is required")
      .max(80)
      .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, "Letters, digits, dot, dash and underscore only"),
    name: z.string().min(1, "A name is required").max(200),
    description: z.string().min(1, "Describe what this purpose is"),
    uses: z.string().min(1, "State what this purpose lets you actually do"),
    lawful_basis: z.string().min(1, "Choose a lawful basis"),
    s7_clause: z.string().optional().nullable(),
    data_categories: z.array(z.string()).min(1, "Rule 3(b)(i): itemise at least one category"),
    retention_days: z.coerce.number().int().min(1, "At least one day").max(36_500),
    retention_basis: z.string().min(1, "Choose a basis"),
    erasure_trigger: z.string().min(1, "Choose a trigger"),
    consent_validity_days: z.coerce.number().int().min(1).max(36_500).optional().nullable(),
    cross_border_permitted: z.boolean(),
    permitted_for_minors: z.boolean(),
    lapse_behaviour: z.string().min(1),
  })
  .refine((v) => v.lawful_basis !== "legitimate_use_s7" || Boolean(v.s7_clause), {
    message: "An s.7 purpose must name the clause it relies on",
    path: ["s7_clause"],
  })
  .refine((v) => v.lawful_basis !== "consent_s6" || !v.s7_clause, {
    message: "A consent purpose must not carry an s.7 clause",
    path: ["s7_clause"],
  });

type FormValues = z.infer<typeof schema>;

export function PurposeForm({
  purpose,
  onDone,
}: {
  /** Present when editing. The API permits edits only while the purpose is a draft. */
  purpose?: Purpose;
  onDone: () => void;
}) {
  const toast = useToast();
  const { data: enums } = useEnums();
  const { data: categories } = useDataCategories();

  const create = useCreatePurpose();
  const update = useUpdatePurpose(purpose?.purpose_uuid ?? "");

  const form = useApiForm(schema, {
    purpose_code: purpose?.purpose_code ?? "",
    name: purpose?.name ?? "",
    description: purpose?.description ?? "",
    uses: purpose?.uses ?? "",
    lawful_basis: purpose?.lawful_basis ?? "consent_s6",
    s7_clause: purpose?.s7_clause ?? null,
    data_categories: purpose?.data_categories ?? [],
    retention_days: 365,
    retention_basis: purpose?.retention_basis ?? "business_policy",
    erasure_trigger: purpose?.erasure_trigger ?? "withdrawal",
    consent_validity_days: null,
    cross_border_permitted: purpose?.cross_border_permitted ?? false,
    permitted_for_minors: purpose?.permitted_for_minors ?? false,
    lapse_behaviour: purpose?.lapse_behaviour ?? "quarantine",
  } as FormValues);

  const basis = form.watch("lawful_basis");
  const selected = form.watch("data_categories");
  const busy = create.isPending || update.isPending;

  const onSubmit = form.submit(async (values) => {
    const payload: PurposeInput = {
      ...values,
      // The server refuses an s.7 clause on a consent purpose, so do not send one.
      s7_clause: values.lawful_basis === "legitimate_use_s7" ? values.s7_clause : null,
      consent_validity_days: values.consent_validity_days || null,
    };

    if (purpose) {
      await update.mutateAsync(payload);
      toast.success("Purpose updated");
    } else {
      await create.mutateAsync(payload);
      toast.success("Purpose created", "It must be activated before a notice can use it.");
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
            hint="Stable identifier. Appears in exports."
            error={form.formState.errors.purpose_code?.message}
            required
          >
            {(p) => (
              <Input
                {...p}
                {...form.register("purpose_code")}
                placeholder="PUR-GAIT-TRAIN"
                disabled={Boolean(purpose)}
              />
            )}
          </Field>

          <Field label="Name" error={form.formState.errors.name?.message} required>
            {(p) => (
              <Input {...p} {...form.register("name")} placeholder="Gait model training" />
            )}
          </Field>
        </div>

        <Field
          label="Description"
          hint="What a data subject reads. Plain language, not internal shorthand."
          error={form.formState.errors.description?.message}
          required
        >
          {(p) => <Textarea {...p} {...form.register("description")} rows={2} />}
        </Field>

        <Field
          label="What this allows"
          hint="Rule 3(b)(ii): the specific uses this purpose enables."
          error={form.formState.errors.uses?.message}
          required
        >
          {(p) => (
            <Textarea
              {...p}
              {...form.register("uses")}
              rows={2}
              placeholder="Train, validate and benchmark models. No decisions are made about you."
            />
          )}
        </Field>

        <CheckboxGroup
          label="Data collected"
          hint="Rule 3(b)(i): itemised. A vague category cannot be consented to meaningfully."
          error={form.formState.errors.data_categories?.message}
          options={categories?.items ?? []}
          value={selected}
          onChange={(next) =>
            form.setValue("data_categories", next, { shouldValidate: true })
          }
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Lawful basis"
            error={form.formState.errors.lawful_basis?.message}
            required
          >
            {(p) => (
              <Select {...p} {...form.register("lawful_basis")}>
                {enums?.lawful_basis?.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          {/* Only shown for s.7: the field is meaningless - and refused - otherwise. */}
          {basis === "legitimate_use_s7" && (
            <Field
              label="Section 7 clause"
              error={form.formState.errors.s7_clause?.message}
              required
            >
              {(p) => (
                <Select {...p} {...form.register("s7_clause")}>
                  <option value="">Choose a clause…</option>
                  {enums?.s7_clause?.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          )}
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field
            label="Retention (days)"
            error={form.formState.errors.retention_days?.message}
            required
          >
            {(p) => (
              <Input {...p} type="number" min={1} {...form.register("retention_days")} />
            )}
          </Field>

          <Field
            label="Retention basis"
            error={form.formState.errors.retention_basis?.message}
            required
          >
            {(p) => (
              <Select {...p} {...form.register("retention_basis")}>
                {enums?.retention_basis?.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Field
            label="Erasure trigger"
            error={form.formState.errors.erasure_trigger?.message}
            required
          >
            {(p) => (
              <Select {...p} {...form.register("erasure_trigger")}>
                {enums?.erasure_trigger?.map((o) => (
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
            label="Consent validity (days)"
            hint="Leave blank for no expiry. After this, the lapse behaviour applies."
            error={form.formState.errors.consent_validity_days?.message}
          >
            {(p) => (
              <Input
                {...p}
                type="number"
                min={1}
                {...form.register("consent_validity_days")}
                placeholder="none"
              />
            )}
          </Field>

          <Field
            label="When consent lapses"
            hint="Quarantine marks the data; erase is irreversible and is never done unattended."
          >
            {(p) => (
              <Select {...p} {...form.register("lapse_behaviour")}>
                {enums?.lapse_behaviour?.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>

        <div className="space-y-2 rounded-md border border-border p-3">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4 accent-[var(--accent)]"
              {...form.register("cross_border_permitted")}
            />
            Transfer outside India is permitted for this purpose
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4 accent-[var(--accent)]"
              {...form.register("permitted_for_minors")}
            />
            May be used for data of children
          </label>
          <p className="text-xs text-text-subtle">
            Both carry additional obligations under the Act. Leave them off unless
            the DPIA covers them.
          </p>
        </div>
      </div>

      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" loading={busy}>
          {purpose ? "Save changes" : "Create purpose"}
        </Button>
      </DialogFooter>
    </form>
  );
}
