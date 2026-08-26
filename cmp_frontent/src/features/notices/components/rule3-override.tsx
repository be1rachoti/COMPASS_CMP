/**
 * Stating Rule 3(b) more narrowly on one notice.
 *
 * A purpose is shared reference data. The same "Loyalty enrolment" is attached
 * to every notice that needs it, and its category list covers every collection
 * it might serve — so a specific project usually takes less than the purpose
 * permits. Until now, saying so meant editing the shared purpose, which changed
 * every other notice using it.
 *
 * Two rules shape the interface, and both are enforced at the API:
 *
 * **A notice may only narrow.** The categories are a checklist over the
 * purpose's own list, not a free-text field, because "subset of that list" is
 * the actual rule and a text box invites typing something outside it. A notice
 * that promised *more* than its purpose permits would be collecting outside the
 * basis it cites.
 *
 * **Nothing selected is not a narrowing.** Rule 3(b)(i) requires the data
 * itemised; an empty list is a notice that itemises nothing. The save button
 * refuses it and says why, rather than letting the server return an error for a
 * state the form should not have allowed.
 *
 * `uses` is free text and cannot be checked mechanically, so it is attributed
 * instead — who narrowed it and when are recorded and shown.
 */
"use client";

import { RotateCcw, SlidersHorizontal } from "lucide-react";
import * as React from "react";

import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Alert, Button, Field, Textarea } from "@/components/ui/primitives";
import { useOverrideNoticePurpose } from "@/features/notices/mutations";
import { humanise } from "@/lib/format";
import { useToast } from "@/providers";
import type { PurposeOnNotice } from "@/types";

/**
 * The inline marker on a purpose row.
 *
 * Shown only when the notice actually says something different, and it names
 * who said so — because "this notice is narrower than its purpose" is a claim
 * somebody has to stand behind at review.
 */
export function Rule3Badge({ purpose }: { purpose: PurposeOnNotice }) {
  if (!purpose.is_overridden) return null;
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full border border-accent-border bg-accent-subtle px-2 py-0.5 text-2xs font-medium text-accent-text"
      title={
        purpose.overridden_by_name
          ? `Narrowed for this notice by ${purpose.overridden_by_name}`
          : "Narrowed for this notice"
      }
    >
      <SlidersHorizontal className="size-2.5" aria-hidden="true" />
      narrowed here
    </span>
  );
}

export function Rule3OverrideDialog({
  noticeUuid,
  purpose,
  onClose,
}: {
  noticeUuid: string;
  purpose: PurposeOnNotice | null;
  onClose: () => void;
}) {
  if (!purpose) return null;
  // Keyed so opening a different purpose starts from that purpose's own state
  // rather than inheriting the previous one's selection.
  return (
    <Rule3OverrideBody
      key={purpose.purpose_uuid}
      noticeUuid={noticeUuid}
      purpose={purpose}
      onClose={onClose}
    />
  );
}

function Rule3OverrideBody({
  noticeUuid,
  purpose,
  onClose,
}: {
  noticeUuid: string;
  purpose: PurposeOnNotice;
  onClose: () => void;
}) {
  const toast = useToast();
  const override = useOverrideNoticePurpose(noticeUuid);

  const [categories, setCategories] = React.useState<string[]>(purpose.data_categories);
  const [uses, setUses] = React.useState(purpose.uses);
  const [error, setError] = React.useState<string | null>(null);

  const available = purpose.purpose_data_categories;
  const narrowedCategories = categories.length < available.length;
  const narrowedUses = uses.trim() !== purpose.purpose_uses.trim();
  const changed = narrowedCategories || narrowedUses || purpose.is_overridden;

  function toggle(category: string) {
    setError(null);
    setCategories((current) =>
      current.includes(category)
        ? current.filter((c) => c !== category)
        : [...current, category],
    );
  }

  async function save(clear: boolean) {
    setError(null);
    if (!clear && categories.length === 0) {
      setError(
        "Rule 3(b)(i) requires the data itemised. Selecting nothing is not a narrowing — " +
          "it is a notice that itemises nothing.",
      );
      return;
    }

    try {
      await override.mutateAsync({
        purposeUuid: purpose.purpose_uuid,
        body: clear
          ? { data_categories: null, uses: null }
          : {
              // Send only what actually differs. Sending an override identical
              // to the purpose would record an attribution for a decision
              // nobody made.
              data_categories: narrowedCategories ? categories : null,
              uses: narrowedUses ? uses.trim() : null,
            },
      });
      toast.success(
        clear ? "Reverted" : "Notice narrowed",
        clear
          ? "This notice uses the purpose's own wording again."
          : "This notice now states Rule 3(b) more narrowly than its purpose.",
      );
      onClose();
    } catch (err) {
      setError(
        err && typeof err === "object" && "userMessage" in err
          ? (err as { userMessage: () => string }).userMessage()
          : "Could not save.",
      );
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        title={`Rule 3(b) for ${purpose.name}`}
        description="What this notice says, which may be narrower than the purpose it cites — and never wider."
      >
        <div className="space-y-5">
          {error && <Alert tone="danger">{error}</Alert>}

          <fieldset>
            <legend className="text-sm font-medium">
              Rule 3(b)(i) — the personal data collected
            </legend>
            <p className="mb-2 mt-0.5 text-xs text-text-muted">
              A checklist over the purpose&rsquo;s own list, because the rule is
              &ldquo;a subset of that&rdquo;. Uncheck what this collection does not take.
            </p>

            <div className="grid gap-1.5 sm:grid-cols-2">
              {available.map((category) => (
                <label
                  key={category}
                  className="flex cursor-pointer items-center gap-2 rounded-lg border border-border px-2.5 py-2 text-sm transition-colors hover:bg-bg-inset has-[:checked]:border-accent-border has-[:checked]:bg-accent-subtle"
                >
                  <input
                    type="checkbox"
                    checked={categories.includes(category)}
                    onChange={() => toggle(category)}
                    className="size-4 rounded border-border-strong accent-[var(--accent)]"
                  />
                  <span>{humanise(category)}</span>
                </label>
              ))}
            </div>

            {narrowedCategories && (
              <p className="mt-2 text-xs text-accent-text">
                {available.length - categories.length} of {available.length} excluded on this
                notice.
              </p>
            )}
          </fieldset>

          <Field
            label="Rule 3(b)(ii) — what this enables"
            hint="The sentence a data principal is agreeing to. Leave it as the purpose's wording unless this collection does something narrower."
          >
            {(props) => (
              <Textarea
                {...props}
                rows={4}
                value={uses}
                maxLength={20_000}
                onChange={(e) => {
                  setUses(e.target.value);
                  setError(null);
                }}
              />
            )}
          </Field>

          {narrowedUses && (
            <details className="rounded-lg border border-border bg-bg-subtle">
              <summary className="cursor-pointer select-none px-3 py-2 text-xs font-medium text-text-muted">
                What the purpose itself says
              </summary>
              <p className="px-3 pb-3 text-xs leading-relaxed text-text-muted">
                {purpose.purpose_uses}
              </p>
            </details>
          )}

          {purpose.is_overridden && (
            <Alert tone="info">
              This notice already states Rule 3(b) more narrowly
              {purpose.overridden_by_name ? `, set by ${purpose.overridden_by_name}` : ""}.
              Reverting restores the purpose&rsquo;s own wording here and changes no other
              notice.
            </Alert>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          {purpose.is_overridden && (
            <Button variant="secondary" loading={override.isPending} onClick={() => save(true)}>
              <RotateCcw className="size-4" />
              Use the purpose&rsquo;s wording
            </Button>
          )}
          <Button
            variant="primary"
            loading={override.isPending}
            disabled={!changed}
            onClick={() => save(false)}
          >
            Save for this notice
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
