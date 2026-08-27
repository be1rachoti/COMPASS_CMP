/**
 * Authoring a notice.
 *
 * The three URLs are required by s.5(1) and frozen at publication: a
 * mistake here is not editable afterwards, it is a new notice version and
 * a fresh approval. The form validates them before the server has to.
 */
"use client";

import * as React from "react";
import { FormError, useApiForm } from "@/components/forms";
import { DialogFooter } from "@/components/ui/dialog";
import { Button, Field, Input, Select, Textarea } from "@/components/ui/primitives";
import { type NoticeInput, useCreateNotice, useUpdateNotice } from "@/features/notices";
import { useEnums } from "@/features/meta";
import type { Notice } from "@/types";
import { useToast } from "@/providers";
import { noticeSchema } from "@/features/notices/schemas";

/**
 * Who a notice addresses.
 *
 * A fixed list rather than `/meta/enums`, because the wording here is doing
 * work the raw labels do not: "Employee" alone leaves somebody guessing whether
 * a contractor counts.
 */
const AUDIENCES = [
  { value: "data_subject", label: "Data subjects — people outside the organisation" },
  { value: "employee", label: "Employees" },
  { value: "ex_employee", label: "Former employees" },
  { value: "others", label: "Others" },
] as const;

export function NoticeForm({
  projectUuid,
  notice,
  onDone,
}: {
  projectUuid?: string;
  notice?: Notice;
  onDone: () => void;
}) {
  const toast = useToast();
  const { data: enums } = useEnums();
  const create = useCreateNotice(projectUuid ?? "");
  const update = useUpdateNotice(notice?.notice_uuid ?? "");

  // Off by default: the whole point of generating the code is that nobody has to
  // think about it. The escape hatch stays for an organisation that already has a
  // numbering scheme it has to match.
  const [ownCode, setOwnCode] = React.useState(false);

  const form = useApiForm(noticeSchema, {
    notice_code: notice?.notice_code ?? "",
    withdraw_url: notice?.withdraw_url ?? "",
    exercise_rights_url: notice?.exercise_rights_url ?? "",
    board_complaint_url: notice?.board_complaint_url ?? "",
    dpo_contact: notice?.dpo_contact ?? "",
    applicable_to: notice?.applicable_to ?? "",
    note: notice?.note ?? "",
    change_class: notice?.change_class ?? "",
    language_code: "english",
    rendered_text: "",
  });

  const busy = create.isPending || update.isPending;

  const onSubmit = form.submit(async (values) => {
    if (notice) {
      // Editing touches the notice's own fields only. The text lives on the
      // language rendition and has its own editor, which knows that replacing
      // approved text clears its approval.
      await update.mutateAsync({
        withdraw_url: values.withdraw_url,
        exercise_rights_url: values.exercise_rights_url,
        board_complaint_url: values.board_complaint_url,
        dpo_contact: values.dpo_contact,
        applicable_to: values.applicable_to || null,
        note: values.note || null,
        change_class: values.change_class || null,
      });
      toast.success("Notice updated");
    } else {
      const payload: NoticeInput = {
        withdraw_url: values.withdraw_url,
        exercise_rights_url: values.exercise_rights_url,
        board_complaint_url: values.board_complaint_url,
        dpo_contact: values.dpo_contact,
        applicable_to: values.applicable_to || null,
        note: values.note || null,
        change_class: values.change_class || null,
        // Empty means "generate one" to the API. Sending "" would be a code.
        notice_code: ownCode && values.notice_code ? values.notice_code : null,
        rendered_text: values.rendered_text?.trim() ? values.rendered_text : null,
        language_code: values.rendered_text?.trim() ? values.language_code || "english" : null,
      };
      const created = await create.mutateAsync(payload);
      toast.success(
        `Notice ${created.notice_code} created`,
        values.rendered_text?.trim()
          ? "Attach purposes, then approve the text and publish."
          : "Add the notice text and its purposes, then publish.",
      );
    }
    onDone();
  });

  return (
    <form method="post" onSubmit={onSubmit} noValidate>
      <FormError message={form.formError} />

      <div className="space-y-4">
        {notice ? (
          <Field label="Notice code" hint="Fixed. A new version keeps the code and increments the version.">
            {(p) => <Input {...p} value={notice.notice_code} readOnly disabled />}
          </Field>
        ) : ownCode ? (
          <Field
            label="Notice code"
            hint="Stable across versions. Publishing a new version keeps the code and increments the version."
            error={form.formState.errors.notice_code?.message}
            required
          >
            {(p) => (
              <>
                <Input {...p} {...form.register("notice_code")} placeholder="NTC-GAIT-2026" />
                <button
                  type="button"
                  onClick={() => setOwnCode(false)}
                  className="mt-1.5 text-xs text-accent-text underline underline-offset-2"
                >
                  Let the system generate it instead
                </button>
              </>
            )}
          </Field>
        ) : (
          <div className="rounded-lg border border-border bg-bg-subtle px-3 py-2.5">
            <p className="text-sm text-text">
              The notice code is generated for you
            </p>
            <p className="mt-0.5 text-xs text-text-muted">
              From the project name and the year, checked for uniqueness across the
              platform. You cannot see other projects&rsquo; codes, so choosing one
              by hand is guesswork.
            </p>
            <button
              type="button"
              onClick={() => setOwnCode(true)}
              className="mt-1.5 text-xs text-accent-text underline underline-offset-2"
            >
              Set the code myself
            </button>
          </div>
        )}

        <Field
          label="DPO contact"
          error={form.formState.errors.dpo_contact?.message}
          required
        >
          {(p) => (
            <Input {...p} {...form.register("dpo_contact")} placeholder="privacy@example.org" />
          )}
        </Field>

        <Field
          label="Applies to"
          hint="Who this notice addresses. Required before it can be published — one answer, not several."
          error={form.formState.errors.applicable_to?.message}
        >
          {(p) => (
            <Select {...p} {...form.register("applicable_to")}>
              <option value="">Not decided yet</option>
              {AUDIENCES.map((a) => (
                <option key={a.value} value={a.value}>
                  {a.label}
                </option>
              ))}
            </Select>
          )}
        </Field>

        {/* Below the audience because it is read in the same breath: who this is
            for, then what the person collecting from them needs to know. */}
        <Field
          label="Note for the collector"
          hint="Shown to whoever collects against this notice, and never to the data principal. Optional."
          error={form.formState.errors.note?.message}
        >
          {(p) => (
            <Textarea
              {...p}
              {...form.register("note")}
              rows={2}
              placeholder="Record the participant ID on the consent sheet before capture."
            />
          )}
        </Field>

        <Field
          label="Withdraw consent URL"
          hint="Withdrawing must be as easy as giving consent was."
          error={form.formState.errors.withdraw_url?.message}
          required
        >
          {(p) => <Input {...p} {...form.register("withdraw_url")} placeholder="https://…/withdraw" />}
        </Field>

        <Field
          label="Exercise rights URL"
          error={form.formState.errors.exercise_rights_url?.message}
          required
        >
          {(p) => <Input {...p} {...form.register("exercise_rights_url")} placeholder="https://…/rights" />}
        </Field>

        <Field
          label="Board complaint URL"
          hint="The Data Protection Board portal — not our own grievance form. The two are different remedies."
          error={form.formState.errors.board_complaint_url?.message}
          required
        >
          {(p) => (
            <Input
              {...p}
              {...form.register("board_complaint_url")}
              placeholder="https://dpb.gov.in/complaint"
            />
          )}
        </Field>

        {!notice && (
          <>
            <div className="rule-fade h-px" aria-hidden="true" />

            <Field
              label="Language"
              hint="Which rendition the text below is. More can be added afterwards."
            >
              {(p) => (
                <Select {...p} {...form.register("language_code")}>
                  {(enums?.language_code ?? [{ value: "english", label: "English" }]).map(
                    (o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ),
                  )}
                </Select>
              )}
            </Field>

            <Field
              label="Notice text"
              hint="What a data subject actually reads. Optional here — but publication needs it, and it is easier to paste now than to come back for it."
              error={form.formState.errors.rendered_text?.message}
            >
              {(p) => (
                <Textarea
                  {...p}
                  {...form.register("rendered_text")}
                  rows={12}
                  className="min-h-56 font-mono text-xs leading-relaxed"
                  placeholder={
                    "NOTICE UNDER SECTION 5, DIGITAL PERSONAL DATA PROTECTION ACT 2023\n\n" +
                    "Who is asking. …\n\n" +
                    "What we will collect. …\n\n" +
                    "Why. …\n\n" +
                    "How to withdraw. …"
                  }
                />
              )}
            </Field>

            <p className="text-xs text-text-subtle">
              Saved text is hashed on publication, and that hash travels with every
              consent given against it. Editing after publication is not possible —
              a correction is a new version.
            </p>
          </>
        )}

        {notice && (
          <Field
            label="Change class"
            hint="Material changes require fresh consent; superficial ones do not."
          >
            {(p) => (
              <Select {...p} {...form.register("change_class")}>
                <option value="">Not classified</option>
                {enums?.change_class?.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}
      </div>

      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" loading={busy}>
          {notice ? "Save changes" : "Create notice"}
        </Button>
      </DialogFooter>
    </form>
  );
}
