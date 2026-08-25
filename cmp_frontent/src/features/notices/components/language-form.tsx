/**
 * Adding a language rendition.
 *
 * s.5(3): a notice has to be available in English and the Eighth Schedule
 * languages. Each rendition is approved separately, because nothing on
 * this screen can tell whether a Marathi translation says what the English
 * one says.
 */
"use client";

import { AlertTriangle } from "lucide-react";
import { FormError, useApiForm } from "@/components/forms";
import { DialogFooter } from "@/components/ui/dialog";
import { Alert, Button, Field, Select, Textarea } from "@/components/ui/primitives";
import { useSetLanguage } from "@/features/notices";
import { useEnums } from "@/features/meta";
import type { LanguageCode } from "@/types";
import { useToast } from "@/providers";
import { languageSchema } from "@/features/notices/schemas";

export function LanguageForm({
  noticeUuid,
  existingCode,
  existingText,
  wasApproved,
  onDone,
}: {
  noticeUuid: string;
  existingCode?: LanguageCode;
  existingText?: string;
  /** Replacing approved text clears the approval - say so before they type. */
  wasApproved?: boolean;
  onDone: () => void;
}) {
  const toast = useToast();
  const { data: enums } = useEnums();
  const save = useSetLanguage(noticeUuid);

  const form = useApiForm(languageSchema, {
    language_code: existingCode ?? "english",
    rendered_text: existingText ?? "",
  });

  const onSubmit = form.submit(async (values) => {
    await save.mutateAsync({
      language_code: values.language_code as LanguageCode,
      rendered_text: values.rendered_text,
    });
    toast.success(
      "Rendition saved",
      wasApproved
        ? "Its approval has been cleared — the text changed, so it needs approving again."
        : "It must be legally approved before the notice can be published.",
    );
    onDone();
  });

  return (
    <form onSubmit={onSubmit} noValidate>
      <FormError message={form.formError} />

      {wasApproved && (
        <Alert tone="warning" className="mb-4">
          <p className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>
              This rendition is already approved. Saving new text clears that
              approval — text that changed after a lawyer signed it off has not
              been signed off.
            </span>
          </p>
        </Alert>
      )}

      <div className="space-y-4">
        <Field
          label="Language"
          error={form.formState.errors.language_code?.message}
          required
        >
          {(p) => (
            <Select {...p} {...form.register("language_code")} disabled={Boolean(existingCode)}>
              {enums?.language_code?.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <Field
          label="Notice text"
          hint="Exactly what the data subject will read. This is hashed at publication and becomes the record of what they agreed to."
          error={form.formState.errors.rendered_text?.message}
          required
        >
          {(p) => (
            <Textarea
              {...p}
              {...form.register("rendered_text")}
              rows={16}
              className="font-mono text-xs leading-relaxed"
              placeholder={"NOTICE UNDER SECTION 5, DIGITAL PERSONAL DATA PROTECTION ACT 2023\n\nWho is asking…"}
            />
          )}
        </Field>
      </div>

      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" loading={save.isPending}>
          Save rendition
        </Button>
      </DialogFooter>
    </form>
  );
}
