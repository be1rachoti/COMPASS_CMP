/**
 * Notice authoring: the notice itself, its purposes, and its language renditions.
 *
 * Everything here is editable only while the notice is a draft, and the forms do
 * not pretend otherwise — publication freezes the text and its hash, and the
 * database refuses an edit afterwards. A form that let someone type into a
 * published notice and then failed on submit would be worse than no form.
 *
 * The language editor is where the care goes. Re-uploading a rendition clears
 * its approval, because text that changed after a lawyer signed it off has not
 * been signed off. The form says so before the user overwrites anything.
 */
"use client";

import { AlertTriangle, Trash2 } from "lucide-react";
import * as React from "react";
import { z } from "zod";

import { FormError, useApiForm } from "@/components/forms/form";
import { DialogFooter } from "@/components/ui/dialog";
import {
  Alert,
  Button,
  Field,
  Input,
  Select,
  Textarea,
} from "@/components/ui/primitives";
import {
  useAttachPurpose,
  useCopyNotice,
  useCreateNotice,
  useDetachPurpose,
  useSetLanguage,
  useUpdateNotice,
  type NoticeInput,
} from "@/lib/mutations";
import { useAllNotices, useEnums, useNoticePurposes, usePurposes } from "@/lib/queries";
import type { LanguageCode, Notice } from "@/lib/types";
import { useToast } from "@/providers";

/* =================================================================== notice */

const httpUrl = z
  .string()
  .min(1, "Required")
  .regex(/^https?:\/\/[^\s<>"]+$/, "Must be an http(s) URL a data subject can open");

const noticeSchema = z.object({
  // Optional: blank means "let the server mint one". Still validated when given,
  // because a code someone typed by hand has to satisfy the same rule.
  notice_code: z
    .string()
    .max(80)
    .regex(
      /^([A-Za-z0-9][A-Za-z0-9._-]*)?$/,
      "Letters, digits, dot, dash and underscore only",
    )
    .optional(),
  withdraw_url: httpUrl,
  exercise_rights_url: httpUrl,
  board_complaint_url: httpUrl,
  dpo_contact: z.string().min(3, "How the DPO can be reached").max(255),
  change_class: z.string().optional().nullable(),
  language_code: z.string().optional(),
  rendered_text: z.string().optional(),
});

type NoticeValues = z.infer<typeof noticeSchema>;

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

  const form = useApiForm<NoticeValues>(noticeSchema, {
    notice_code: notice?.notice_code ?? "",
    withdraw_url: notice?.withdraw_url ?? "",
    exercise_rights_url: notice?.exercise_rights_url ?? "",
    board_complaint_url: notice?.board_complaint_url ?? "",
    dpo_contact: notice?.dpo_contact ?? "",
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
        change_class: values.change_class || null,
      });
      toast.success("Notice updated");
    } else {
      const payload: NoticeInput = {
        withdraw_url: values.withdraw_url,
        exercise_rights_url: values.exercise_rights_url,
        board_complaint_url: values.board_complaint_url,
        dpo_contact: values.dpo_contact,
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
    <form onSubmit={onSubmit} noValidate>
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

/* ========================================================== attach purposes */

export function NoticePurposesForm({
  noticeUuid,
  onDone,
}: {
  noticeUuid: string;
  onDone: () => void;
}) {
  const toast = useToast();
  const attached = useNoticePurposes(noticeUuid);
  const { data: available } = usePurposes({ status: "active", limit: 100 });
  const attach = useAttachPurpose(noticeUuid);
  const detach = useDetachPurpose(noticeUuid);

  const [chosen, setChosen] = React.useState("");
  const [mandatory, setMandatory] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const attachedUuids = new Set((attached.data ?? []).map((p) => p.purpose_uuid));
  const selectable = (available?.items ?? []).filter((p) => !attachedUuids.has(p.purpose_uuid));

  async function add() {
    if (!chosen) {
      setError("Choose a purpose to attach.");
      return;
    }
    setError(null);
    try {
      await attach.mutateAsync({
        purpose_uuid: chosen,
        display_order: attached.data?.length ?? 0,
        is_mandatory: mandatory,
      });
      toast.success("Purpose attached");
      setChosen("");
      setMandatory(false);
      await attached.refetch();
    } catch (err) {
      setError(
        err && typeof err === "object" && "userMessage" in err
          ? (err as { userMessage: () => string }).userMessage()
          : "Could not attach that purpose.",
      );
    }
  }

  async function remove(uuid: string, name: string) {
    try {
      await detach.mutateAsync(uuid);
      toast.success("Purpose removed", name);
      await attached.refetch();
    } catch (err) {
      setError(
        err && typeof err === "object" && "userMessage" in err
          ? (err as { userMessage: () => string }).userMessage()
          : "Could not remove that purpose.",
      );
    }
  }

  return (
    <div>
      <FormError message={error} />

      <ul className="mb-4 divide-y divide-border rounded-md border border-border">
        {(attached.data ?? []).length === 0 && (
          <li className="px-3 py-4 text-center text-sm text-text-muted">
            No purposes attached. A notice with none asks a data subject to agree
            to nothing in particular.
          </li>
        )}
        {(attached.data ?? []).map((p) => (
          <li key={p.purpose_uuid} className="flex items-center justify-between gap-3 px-3 py-2.5">
            <div className="min-w-0">
              <p className="text-sm font-medium">{p.name}</p>
              <p className="mt-0.5 text-xs text-text-subtle">
                {p.purpose_code}
                {p.is_mandatory && " · cannot be refused"}
              </p>
            </div>
            <Button
              variant="subtle"
              size="sm"
              loading={detach.isPending}
              onClick={() => remove(p.purpose_uuid, p.name)}
            >
              <Trash2 className="size-4" />
              Remove
            </Button>
          </li>
        ))}
      </ul>

      <div className="space-y-3 rounded-md border border-border p-3">
        <Field label="Attach a purpose">
          {(p) => (
            <Select {...p} value={chosen} onChange={(e) => setChosen(e.target.value)}>
              <option value="">Choose an active purpose…</option>
              {selectable.map((purpose) => (
                <option key={purpose.purpose_uuid} value={purpose.purpose_uuid}>
                  {purpose.name} · {purpose.purpose_code}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-0.5 size-4 accent-[var(--accent)]"
            checked={mandatory}
            onChange={(e) => setMandatory(e.target.checked)}
          />
          <span>
            Cannot be refused
            <span className="mt-0.5 block text-xs text-text-subtle">
              This should be rare and should make you uncomfortable. If a purpose
              cannot be refused, ask whether it belongs in this notice at all.
            </span>
          </span>
        </label>

        <Button variant="secondary" loading={attach.isPending} onClick={add}>
          Attach
        </Button>
      </div>

      <DialogFooter>
        <Button variant="primary" onClick={onDone}>
          Done
        </Button>
      </DialogFooter>
    </div>
  );
}

/* ======================================================= language rendition */

const languageSchema = z.object({
  language_code: z.string().min(1, "Choose a language"),
  rendered_text: z.string().min(50, "The notice text looks too short to be complete"),
});

type LanguageValues = z.infer<typeof languageSchema>;

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

  const form = useApiForm<LanguageValues>(languageSchema, {
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

/* ============================================ start from an existing notice */

/**
 * Copy a notice that already exists into this project.
 *
 * The API copies rather than shares. A notice belongs to exactly one project,
 * because every consent artefact records which notice was served — two projects
 * pointing at one row would make "which text did she agree to, for which
 * project" unanswerable. What comes across is the wording, the purposes and the
 * renditions; what does not is the legal approval, because a lawyer approved
 * that text for that project's recipients.
 */
export function NoticeCopyForm({
  projectUuid,
  onDone,
}: {
  projectUuid: string;
  onDone: () => void;
}) {
  const toast = useToast();
  const copy = useCopyNotice(projectUuid);
  const [selected, setSelected] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  // Published notices only. Copying a half-finished draft propagates whatever is
  // wrong with it, and a published one has at least been through the checklist.
  const notices = useAllNotices({ status: "published", limit: 100 });
  const options = notices.data?.items ?? [];

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      const created = await copy.mutateAsync({ source_notice_uuid: selected });
      toast.success(
        `Copied into ${created.notice_code}`,
        "It is a fresh draft. Review the wording, then approve and publish it.",
      );
      onDone();
    } catch (err) {
      setError(
        err && typeof err === "object" && "userMessage" in err
          ? (err as { userMessage: () => string }).userMessage()
          : "Could not copy that notice.",
      );
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate>
      <FormError message={error} />

      {notices.isLoading ? (
        <p className="text-sm text-text-muted">Loading published notices…</p>
      ) : options.length === 0 ? (
        <Alert tone="info">
          There are no published notices to copy from yet. Create this project&rsquo;s
          notice from scratch.
        </Alert>
      ) : (
        <div className="space-y-4">
          <Field label="Notice to copy" required>
            {(p) => (
              <Select {...p} value={selected} onChange={(e) => setSelected(e.target.value)}>
                <option value="">Choose a published notice…</option>
                {options.map((n) => (
                  <option key={n.notice_uuid} value={n.notice_uuid}>
                    {n.notice_code} v{n.version} — {n.project_name}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Alert tone="warning" title="What comes across, and what does not">
            <p className="leading-relaxed">
              The wording, the purposes and every language rendition are copied. The
              legal approvals are not — a lawyer signed that text off for the other
              project&rsquo;s recipients, and carrying the sign-off over would launder
              an approval nobody gave. Re-approve each rendition here before
              publishing.
            </p>
          </Alert>
        </div>
      )}

      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" loading={copy.isPending} disabled={!selected}>
          Copy into this project
        </Button>
      </DialogFooter>
    </form>
  );
}
