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
  });

  const busy = create.isPending || update.isPending;

  const onSubmit = form.submit(async (values) => {
    const payload = {
      ...values,
      username: values.username || null,
      mobile: values.mobile || null,
      organization_id: values.organization_id || null,
      person_type: values.person_type || null,
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
        "It starts pending. The user activates it through the password reset flow.",
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
