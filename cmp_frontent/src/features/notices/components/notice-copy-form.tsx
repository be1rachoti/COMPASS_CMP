/**
 * Starting a notice from one that already exists.
 *
 * The server copies rather than shares. A notice belongs to exactly one
 * project, because every consent artefact records which notice was served,
 * and a shared row would make "which text, for which project" unanswerable.
 */
"use client";

import * as React from "react";
import { FormError } from "@/components/forms";
import { DialogFooter } from "@/components/ui/dialog";
import { Alert, Button, Field, Select } from "@/components/ui/primitives";
import { useCopyNotice } from "@/features/notices";
import { useAllNotices } from "@/features/notices";
import { useToast } from "@/providers";

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
    <form method="post" onSubmit={onSubmit} noValidate>
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
