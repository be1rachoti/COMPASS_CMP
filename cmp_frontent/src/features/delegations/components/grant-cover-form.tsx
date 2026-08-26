/**
 * Arranging cover.
 *
 * Two fields matter and one of them is a warning. The colleague has to be in the
 * same role — the API refuses anything else, because cover across roles would be
 * a privilege-escalation path with a friendly name — so the list only offers
 * people who qualify, and says why when it is empty.
 *
 * The end date is optional and shouldn't be. Open-ended cover is a real
 * arrangement, but a known return date is the better one: cover that expires by
 * itself is cover nobody has to remember to end, and "remember to end it" is
 * exactly the step that gets skipped.
 */
"use client";

import { Info } from "lucide-react";
import * as React from "react";

import { FormError } from "@/components/forms";
import { DialogFooter } from "@/components/ui/dialog";
import { Alert, Button, Field, Input, Select, Textarea } from "@/components/ui/primitives";
import { useGrantDelegation } from "@/features/delegations/mutations";
import { useUsers } from "@/features/users";
import { useAuth, useToast } from "@/providers";

/**
 * The earliest end date worth offering: tomorrow.
 *
 * Computed once rather than per render. `new Date()` during render is impure —
 * React may render twice and get two answers — and the value does not need to
 * change while a dialog is open.
 */
function tomorrow(): string {
  return new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
}

export function GrantCoverForm({ onDone }: { onDone: () => void }) {
  const { me } = useAuth();
  const toast = useToast();
  const grant = useGrantDelegation();

  const [delegate, setDelegate] = React.useState("");
  const [endsAt, setEndsAt] = React.useState("");
  const [reason, setReason] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [minEnd] = React.useState(tomorrow);

  // Same role, active, and not the caller. The API enforces all three; this
  // only avoids offering a choice that would be refused.
  const users = useUsers({ role: me?.role, status: "active", limit: 100 });
  const candidates = (users.data?.items ?? []).filter((u) => u.uuid !== me?.uuid);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      const result = await grant.mutateAsync({
        delegate_user_uuid: delegate,
        ends_at: endsAt ? new Date(endsAt).toISOString() : null,
        reason: reason.trim() || null,
      });
      // The server says whether this actually grants anything. For a DPO it does
      // not - they already read every record - and repeating its answer means
      // the toast cannot claim an effect the arrangement does not have.
      toast[result.grants_access ? "success" : "info"]("Cover arranged", result.message);
      onDone();
    } catch (err) {
      setError(
        err && typeof err === "object" && "userMessage" in err
          ? (err as { userMessage: () => string }).userMessage()
          : "Could not arrange cover.",
      );
    }
  }

  return (
    <form method="post" onSubmit={submit} noValidate>
      <FormError message={error} />

      <div className="space-y-4">
        {candidates.length === 0 && !users.isLoading && (
          <Alert tone="info">
            <span className="flex items-start gap-2">
              <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              There is nobody else in your role to cover for you. Cover has to be
              arranged with somebody who holds the same responsibilities — an
              administrator can provision a colleague.
            </span>
          </Alert>
        )}

        <Field
          label="Who is covering"
          hint="Somebody in your own role. They reach your projects; nothing changes hands."
          required
        >
          {(p) => (
            <Select
              {...p}
              value={delegate}
              onChange={(e) => setDelegate(e.target.value)}
              disabled={candidates.length === 0}
            >
              <option value="">Choose a colleague…</option>
              {candidates.map((u) => (
                <option key={u.uuid} value={u.uuid}>
                  {u.full_name} · {u.email}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <Field
          label="Until"
          hint="Leave empty for open-ended cover. A date is better: it ends by itself, and nobody has to remember to end it."
        >
          {(p) => (
            <Input
              {...p}
              type="date"
              value={endsAt}
              min={minEnd}
              onChange={(e) => setEndsAt(e.target.value)}
            />
          )}
        </Field>

        <Field label="Why" hint="Recorded in the audit trail. A sentence is enough.">
          {(p) => (
            <Textarea
              {...p}
              rows={2}
              value={reason}
              maxLength={1000}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Annual leave, 12–26 September"
            />
          )}
        </Field>
      </div>

      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" loading={grant.isPending} disabled={!delegate}>
          Arrange cover
        </Button>
      </DialogFooter>
    </form>
  );
}
