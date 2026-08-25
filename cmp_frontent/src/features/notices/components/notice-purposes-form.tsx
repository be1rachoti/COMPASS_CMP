/**
 * Attaching purposes to a notice.
 *
 * Rule 3(b) requires a notice to itemise what is collected and why, and a
 * purpose is how that is expressed — so a notice with none cannot be
 * published, and the checklist says so.
 */
"use client";

import * as React from "react";
import { Trash2 } from "lucide-react";
import { FormError } from "@/components/forms";
import { DialogFooter } from "@/components/ui/dialog";
import { Button, Field, Select } from "@/components/ui/primitives";
import { useAttachPurpose, useDetachPurpose } from "@/features/notices";
import { useNoticePurposes } from "@/features/notices";
import { usePurposes } from "@/features/registry";
import { useToast } from "@/providers";

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
