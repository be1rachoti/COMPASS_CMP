/**
 * Recording an approval and its proof.
 *
 * The upload is what unblocks `under_process -> pending_approval`, so the
 * mutation invalidates the transition view as well as the approval list.
 * Without that the user uploads a document and the button they were trying to
 * unblock stays disabled.
 *
 * **The proof is part of the form, not beside it.** It was held in component
 * state while `approvalSchema` listed it as required, so every submit validated
 * `proof: undefined`, failed, and returned — the button did nothing, and no
 * control was bound to `errors.proof` so nothing said why. A form that fails
 * silently is worse than one that fails loudly: there is nothing to read and
 * nothing to search for.
 *
 * So the file goes through `setValue` with `shouldValidate`, which means the
 * schema is the single authority on whether this approval is complete, and the
 * size and type rules in `fileSchema(PROOF)` are actually applied rather than
 * being a second copy of what `FileInput` checks.
 */
"use client";

import * as React from "react";
import { FileInput, FormError, useApiForm } from "@/components/forms";
import { DialogFooter } from "@/components/ui/dialog";
import { Button, Field, Input, Select } from "@/components/ui/primitives";
import { useUploadApproval } from "@/features/projects";
import { useEnums } from "@/features/meta";
import { useToast } from "@/providers";
import { approvalSchema } from "@/features/projects/schemas";

/** Mirrors the server's `validation.files.PROOF`. Checked here so a 25 MB
 *  scan is refused before it is uploaded over a hotel connection. */
const MAX_PROOF_BYTES = 25 * 1024 * 1024;

export function ApprovalForm({
  projectUuid,
  onDone,
}: {
  projectUuid: string;
  onDone: () => void;
}) {
  const toast = useToast();
  const { data: enums } = useEnums();
  const upload = useUploadApproval(projectUuid);
  const form = useApiForm(approvalSchema, {
    approval_type: "security",
    reference_no: "",
    approved_on: "",
  });

  // The file lives in form state so the schema can see it. Watched rather than
  // duplicated into a `useState`, because two copies of "which file" is how the
  // displayed name and the uploaded bytes come apart.
  const file = form.watch("proof") as File | undefined;

  const onSubmit = form.submit(async (values) => {
    await upload.mutateAsync(values);
    toast.success(
      "Approval uploaded",
      "The project can now move to pending approval.",
    );
    onDone();
  });

  return (
    <form method="post" onSubmit={onSubmit} noValidate>
      <FormError message={form.formError} />

      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Type" error={form.formState.errors.approval_type?.message} required>
            {(p) => (
              <Select {...p} {...form.register("approval_type")}>
                {enums?.approval_type?.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Field
            label="Reference number"
            error={form.formState.errors.reference_no?.message}
            required
          >
            {(p) => <Input {...p} {...form.register("reference_no")} placeholder="SEC-2026-0142" />}
          </Field>
        </div>

        <Field
          label="Approved on"
          error={form.formState.errors.approved_on?.message}
          required
        >
          {(p) => <Input {...p} type="date" {...form.register("approved_on")} />}
        </Field>

        <FileInput
          label="Proof document"
          hint="PDF or image, up to 25 MB. Stored with its SHA-256 so it can be checked later."
          accept="application/pdf,image/png,image/jpeg"
          maxBytes={MAX_PROOF_BYTES}
          file={file ?? null}
          onChange={(f) =>
            // `shouldValidate` so choosing a file clears its error immediately
            // rather than on the next submit, and choosing a bad one says so
            // before the upload is attempted.
            form.setValue("proof", f as never, {
              shouldValidate: true,
              shouldDirty: true,
            })
          }
          error={form.formState.errors.proof?.message}
          required
        />
      </div>

      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" loading={upload.isPending}>
          Upload approval
        </Button>
      </DialogFooter>
    </form>
  );
}
