/**
 * User provisioning, editing and role change.
 *
 * Two things the form is careful about:
 *
 * - **No password field.** A provisioned account starts with a random unusable
 *   password and is activated through the reset flow. Emailing somebody an
 *   initial password puts a live credential in a mailbox and in whatever
 *   forwarded it.
 * - **Role and person type are separate controls**, because they answer
 *   different questions. `role` is authorisation; `person_type` is identity. A
 *   DPO is *also* an employee, and a change of employment status must never
 *   silently alter what somebody may do.
 *
 * A role change is its own action, not a field on the edit form, because it
 * terminates every session the user holds — that deserves a deliberate step and
 * a reason, not a checkbox somebody flips while fixing a typo in a surname.
 */
"use client";

import * as React from "react";

import { FormError, useApiForm } from "@/components/forms";
import { DialogFooter } from "@/components/ui/dialog";
import { Alert, Button, Field, Input, Select, Textarea } from "@/components/ui/primitives";
import { useChangeRole, useCreateUser, useUpdateUser } from "@/features/users";
import { useEnums } from "@/features/meta";
import { useSources } from "@/features/registry";
import type { User } from "@/types";
import { useToast } from "@/providers";
import {
  roleSchema,
  userSchema,
} from "@/features/users/schemas";

/* ============================================================ create / edit */

export function UserForm({ user, onDone }: { user?: User; onDone: () => void }) {
  const toast = useToast();
  const { data: enums } = useEnums();
  const create = useCreateUser();
  const update = useUpdateUser(user?.uuid ?? "");

  const form = useApiForm(userSchema, {
    full_name: user?.full_name ?? "",
    email: user?.email ?? "",
    role: user?.role ?? "dco",
    username: user?.username ?? "",
    mobile: user?.mobile ?? "",
    organization_id: user?.organization_id ?? "",
    person_type: user?.person_type ?? "employee",
    source_uuids: [] as string[],
  });

  const role = form.watch("role");
  const sourceUuids = form.watch("source_uuids") ?? [];
  // Only the roles that can hold a source, and only the sources that match:
  // a DCO takes a third party's collection, an RCO takes the R&D team's own.
  // Both rules are the server's; mirroring them here means the wrong option is
  // absent rather than offered and then refused.
  const ownsSources = role === "dco" || role === "rco";
  const { data: sources } = useSources(
    ownsSources ? { status: "active", in_house: role === "rco", limit: 100 } : { limit: 1 },
  );
  const eligible = ownsSources ? (sources?.items ?? []) : [];

  // A role change clears the selection rather than carrying it: the sources a
  // DCO could own are exactly the ones an RCO could not.
  React.useEffect(() => {
    if (sourceUuids.length && !ownsSources) {
      form.setValue("source_uuids", [], { shouldDirty: true });
    }
  }, [ownsSources, sourceUuids.length, form]);

  const busy = create.isPending || update.isPending;

  const onSubmit = form.submit(async (values) => {
    const payload = {
      ...values,
      username: values.username || null,
      mobile: values.mobile || null,
      organization_id: values.organization_id || null,
      person_type: values.person_type || null,
      source_uuids: values.source_uuids ?? [],
    };

    if (user) {
      // The API accepts only name and contact here; role is a separate,
      // audited action and email is the account's identity.
      await update.mutateAsync({
        full_name: payload.full_name,
        mobile: payload.mobile,
        organization_id: payload.organization_id,
      });
      toast.success("Account updated");
    } else {
      await create.mutateAsync(payload);
      toast.success(
        "Account created",
        payload.source_uuids.length
          ? `It starts pending, with ${payload.source_uuids.length} data source(s) attached. ` +
            "The user activates it through the password reset flow."
          : "It starts pending. The user activates it through the password reset flow.",
      );
    }
    onDone();
  });

  return (
    <form method="post" onSubmit={onSubmit} noValidate>
      <FormError message={form.formError} />

      {!user && (
        <Alert tone="info" className="mb-4">
          No password is set here. The account starts with an unusable one and is
          activated by the user through &ldquo;forgotten your password&rdquo; — so no live
          credential is ever sent by email.
        </Alert>
      )}

      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Full name" error={form.formState.errors.full_name?.message} required>
            {(p) => <Input {...p} {...form.register("full_name")} />}
          </Field>

          <Field label="Email" error={form.formState.errors.email?.message} required>
            {(p) => (
              <Input {...p} type="email" {...form.register("email")} disabled={Boolean(user)} />
            )}
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Role"
            hint="Authorisation. What this person may do."
            error={form.formState.errors.role?.message}
            required
          >
            {(p) => (
              <Select {...p} {...form.register("role")} disabled={Boolean(user)}>
                {enums?.user_role
                  // Data subjects register through a consent link, never here.
                  ?.filter((o) => o.value !== "data_subject")
                  .map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
              </Select>
            )}
          </Field>

          <Field
            label="Person type"
            hint="Identity. Separate from role, and changing it never changes permissions."
          >
            {(p) => (
              <Select {...p} {...form.register("person_type")}>
                <option value="">Not recorded</option>
                {enums?.person_type?.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Username" hint="Optional sign-in alias.">
            {(p) => <Input {...p} {...form.register("username")} disabled={Boolean(user)} />}
          </Field>

          <Field label="Mobile">
            {(p) => <Input {...p} type="tel" {...form.register("mobile")} placeholder="+91 ..." />}
          </Field>

          <Field label="Organisation id">
            {(p) => <Input {...p} {...form.register("organization_id")} />}
          </Field>
        </div>

        {/* Creation only. Moving a source between people afterwards belongs on
            the source, where the consequence is visible: it moves every project
            collecting from it, and that count is worth showing. */}
        {!user && ownsSources && (
          <fieldset>
            <legend className="text-sm font-medium">Data sources</legend>
            <p className="mb-2 mt-0.5 text-xs text-text-muted">
              What this person will be accountable for. Projects collecting from any of these
              will appear in their list. Optional — sources can be attached later.
            </p>

            {!eligible.length ? (
              <Alert tone="info">
                No unassigned{" "}
                {role === "rco" ? "in-house" : "third-party"} data sources are registered yet.
              </Alert>
            ) : (
              <div className="grid max-h-52 gap-1.5 overflow-y-auto sm:grid-cols-2">
                {eligible.map((s) => (
                  <label
                    key={s.source_uuid}
                    className="grid cursor-pointer grid-cols-[auto_1fr] items-center gap-x-2 gap-y-0.5 rounded-lg border border-border px-2.5 py-2 text-sm transition-colors hover:bg-bg-inset has-[:checked]:border-accent-border has-[:checked]:bg-accent-subtle"
                  >
                    <input
                      type="checkbox"
                      checked={sourceUuids.includes(s.source_uuid)}
                      onChange={() =>
                        form.setValue(
                          "source_uuids",
                          sourceUuids.includes(s.source_uuid)
                            ? sourceUuids.filter((u) => u !== s.source_uuid)
                            : [...sourceUuids, s.source_uuid],
                          { shouldDirty: true },
                        )
                      }
                      className="size-4 rounded border-border-strong accent-[var(--accent)]"
                    />
                    <span className="block min-w-0 truncate font-medium">{s.name}</span>
                    <span className="col-start-2 truncate font-mono text-2xs text-text-subtle">
                      {s.source_code}
                      {/* Naming the current owner rather than hiding the row:
                          reassigning is legitimate, and a source that silently
                          vanished from the list would look like a bug. */}
                      {s.owner_name ? ` · currently ${s.owner_name}` : ""}
                    </span>
                  </label>
                ))}
              </div>
            )}
          </fieldset>
        )}
      </div>

      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" loading={busy}>
          {user ? "Save changes" : "Create account"}
        </Button>
      </DialogFooter>
    </form>
  );
}

/* ============================================================== role change */

export function RoleChangeForm({ user, onDone }: { user: User; onDone: () => void }) {
  const toast = useToast();
  const { data: enums } = useEnums();
  const change = useChangeRole(user.uuid);

  const form = useApiForm(roleSchema, { role: user.role, reason: "" });
  const next = form.watch("role");

  const onSubmit = form.submit(async (values) => {
    const result = await change.mutateAsync({
      role: values.role,
      reason: values.reason || undefined,
    });
    toast.success("Role changed", result.message ?? undefined);
    onDone();
  });

  return (
    <form method="post" onSubmit={onSubmit} noValidate>
      <FormError message={form.formError} />

      <Alert tone="warning" className="mb-4">
        Changing a role terminates every session {user.full_name} currently holds.
        A session carrying the old role&apos;s permissions must not survive the change.
      </Alert>

      <div className="space-y-4">
        <Field label="New role" error={form.formState.errors.role?.message} required>
          {(p) => (
            <Select {...p} {...form.register("role")}>
              {enums?.user_role
                ?.filter((o) => o.value !== "data_subject")
                .map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
            </Select>
          )}
        </Field>

        <Field
          label="Reason"
          hint="Recorded in the audit trail alongside the change."
        >
          {(p) => (
            <Textarea
              {...p}
              {...form.register("reason")}
              rows={2}
              placeholder="e.g. Moved from the collection team to the Privacy Office."
            />
          )}
        </Field>
      </div>

      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button
          type="submit"
          variant="primary"
          loading={change.isPending}
          disabled={next === user.role}
        >
          Change role
        </Button>
      </DialogFooter>
    </form>
  );
}
