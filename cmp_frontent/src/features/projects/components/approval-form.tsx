/**
 * Recording an approval and its proof.
 *
 * The upload is what unblocks `under_process -> pending_approval`, so the
 * mutation invalidates the transition view as well as the approval list.
 * Without that the user uploads a document and the button they were
 * trying to unblock stays disabled.
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
  const [file, setFile] = React.useState<File | null>(null);
  const [fileError, setFileError] = React.useState<string | null>(null);

  const form = useApiForm(approvalSchema, {
    approval_type: "security",
    reference_no: "",
    approved_on: "",
  });

  const onSubmit = form.submit(async (values) => {
    // INV-8: the proof is not optional metadata, it is the thing that makes the
    // approval count. Checked here so the user is not told after upload.
    if (!file) {
      setFileError("A proof file is mandatory. An approval without one does not count.");
      return;
    }
    setFileError(null);

    await upload.mutateAsync({ ...values, proof: file });
    toast.success(
      "Approval uploaded",
      "The project can now move to pending approval.",
    );
    onDone();
  });

  return (
    <form onSubmit={onSubmit} noValidate>
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
          file={file}
          onChange={(f) => {
            setFile(f);
            setFileError(null);
          }}
          error={fileError ?? undefined}
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
