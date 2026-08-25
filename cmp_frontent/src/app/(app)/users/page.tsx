/**
 * The account register.
 *
 * Two columns that look similar and are not: `role` is authorisation, and
 * `person_type` is identity. They are separate because a DPO is *also* an
 * employee, and a change of employment status must never silently alter what
 * somebody is permitted to do.
 *
 * There is no delete control, because there is no delete endpoint. Accounts
 * deactivate: deleting one orphans every audit row that names it as actor, and
 * an audit entry whose actor cannot be resolved proves nothing.
 */
"use client";

import { KeyRound, Pencil, Plus, ShieldEllipsis, UserCheck, UserX } from "lucide-react";
import * as React from "react";

import { PageHeader } from "@/components/layout/app-shell";
import {
  FilterBar,
  FilterSelect,
  ResourceList,
  SearchBox,
  useCursorStack,
} from "@/components/data-display/resource-list";
import { RoleChangeForm, UserForm } from "@/features/users/components/forms";
import { ConfirmDialog, Dialog, DialogContent } from "@/components/ui/dialog";
import { EmptyRecords } from "@/components/ui/graphics";
import { Alert, Button, Td, Tr } from "@/components/ui/primitives";
import { StatusBadge } from "@/components/ui/status";
import { useEnums } from "@/features/meta";
import { useDeactivateUser, useReactivateUser, useUsers } from "@/features/users";
import { useForceLogout, useResetMfa } from "@/features/users";
import type { User } from "@/types";
import { formatDate, humanise } from "@/lib/format";
import { useAuth, useToast } from "@/providers";

export default function UsersPage() {
  const { me } = useAuth();
  const toast = useToast();
  const stack = useCursorStack();
  const [role, setRole] = React.useState("");
  const [status, setStatus] = React.useState("");
  const [q, setQ] = React.useState("");

  const deactivate = useDeactivateUser();
  const reactivate = useReactivateUser();
  const resetMfa = useResetMfa();
  const forceLogout = useForceLogout();

  const [creating, setCreating] = React.useState(false);
  const [editing, setEditing] = React.useState<User | null>(null);
  const [changingRole, setChangingRole] = React.useState<User | null>(null);
  const [resettingMfa, setResettingMfa] = React.useState<User | null>(null);

  const { data: enums } = useEnums();
  const query = useUsers({
    role: role || undefined,
    status: status || undefined,
    q: q || undefined,
    cursor: stack.cursor,
    limit: 25,
  });

  // The DPO reads this register; only an administrator provisions.
  const isAdmin = me?.role === "admin";

  async function toggle(user: User) {
    const active = user.status === "active";
    try {
      if (active) {
        await deactivate.mutateAsync(user.uuid);
        toast.success("Account deactivated", "Every session was terminated immediately.");
      } else {
        await reactivate.mutateAsync(user.uuid);
        toast.success("Account reactivated", `${user.full_name} can sign in again.`);
      }
    } catch (err) {
      const message =
        err && typeof err === "object" && "userMessage" in err
          ? (err as { userMessage: () => string }).userMessage()
          : "The change could not be applied.";
      toast.error("Could not update the account", message);
    }
  }

  return (
    <>
      <PageHeader
        title="Users"
        description="Staff accounts and registered data subjects. Role is authorisation; person type is identity - changing one never changes the other."
        actions={
          isAdmin ? (
            <Button variant="primary" onClick={() => setCreating(true)}>
              <Plus className="size-4" />
              Provision account
            </Button>
          ) : null
        }
      />

      {!isAdmin && (
        <Alert tone="info" className="mb-4">
          You can read the register. Provisioning, role changes and deactivation
          are restricted to administrators.
        </Alert>
      )}

      <FilterBar>
        <SearchBox
          placeholder="Name, email or organisation id"
          onSubmit={(term) => {
            setQ(term);
            stack.reset();
          }}
        />
        <FilterSelect
          label="Role"
          value={role}
          onChange={(v) => {
            setRole(v);
            stack.reset();
          }}
          options={enums?.user_role ?? []}
          allLabel="All roles"
        />
        <FilterSelect
          label="Status"
          value={status}
          onChange={(v) => {
            setStatus(v);
            stack.reset();
          }}
          options={enums?.user_status ?? []}
          allLabel="All statuses"
        />
      </FilterBar>

      <ResourceList<User>
        query={query}
        stack={stack}
        caption="Registered accounts"
        columns={["Name", "Role", "Person type", "Status", "Registered", "Action"]}
        keyOf={(u) => u.uuid}
        empty={{
          illustration: <EmptyRecords />,
          title: role || status || q ? "No accounts match" : "No accounts",
          description: "Staff are provisioned by an administrator; data subjects self-register through a consent link.",
        }}
        row={(u) => (
          <Tr>
            <Td>
              <span className="font-medium">{u.full_name}</span>
              <p className="mt-0.5 text-xs text-text-subtle">{u.email}</p>
            </Td>
            <Td>
              <StatusBadge kind="role" value={u.role} dot={false} />
            </Td>
            <Td className="text-text-muted">
              {u.person_type ? humanise(u.person_type) : "—"}
            </Td>
            <Td>
              <StatusBadge kind="user" value={u.status} />
            </Td>
            <Td className="whitespace-nowrap text-text-muted">{formatDate(u.created_at)}</Td>
            <Td>
              {isAdmin && (
                <div className="flex flex-wrap gap-1">
                  <Button variant="ghost" size="sm" onClick={() => setEditing(u)}>
                    <Pencil className="size-4" />
                    Edit
                  </Button>

                  {/* Acting on your own row is how an organisation ends up with
                      no administrator, so those controls are absent there. */}
                  {u.uuid !== me?.uuid && u.role !== "data_subject" && (
                    <>
                      <Button variant="ghost" size="sm" onClick={() => setChangingRole(u)}>
                        <ShieldEllipsis className="size-4" />
                        Role
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setResettingMfa(u)}>
                        <KeyRound className="size-4" />
                        Reset MFA
                      </Button>
                    </>
                  )}

                  {u.uuid !== me?.uuid && u.status !== "deactivated" && (
                    <Button
                      variant="subtle"
                      size="sm"
                      loading={deactivate.isPending}
                      onClick={() => toggle(u)}
                    >
                      <UserX className="size-4" />
                      Deactivate
                    </Button>
                  )}
                  {u.status === "deactivated" && (
                    <Button
                      variant="secondary"
                      size="sm"
                      loading={reactivate.isPending}
                      onClick={() => toggle(u)}
                    >
                      <UserCheck className="size-4" />
                      Reactivate
                    </Button>
                  )}
                </div>
              )}
            </Td>
          </Tr>
        )}
      />

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent
          title="Provision an account"
          description="No password is set here - the user activates it themselves."
          size="lg"
        >
          <UserForm onDone={() => setCreating(false)} />
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(editing)} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent title="Edit account" size="lg">
          {editing && <UserForm user={editing} onDone={() => setEditing(null)} />}
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(changingRole)} onOpenChange={(o) => !o && setChangingRole(null)}>
        <DialogContent title="Change role" description="Audited, and it ends every session.">
          {changingRole && (
            <RoleChangeForm user={changingRole} onDone={() => setChangingRole(null)} />
          )}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={Boolean(resettingMfa)}
        onOpenChange={(o) => !o && setResettingMfa(null)}
        title={`Reset MFA for ${resettingMfa?.full_name ?? ""}?`}
        confirmLabel="Reset MFA"
        loading={resetMfa.isPending}
        tone="primary"
        consequence={
          <p>
            Their outstanding verification code is discarded and every session
            ends. They will be asked for a fresh code the next time they sign in.
            Use this when somebody has lost access to their email, not as routine
            maintenance.
          </p>
        }
        onConfirm={async () => {
          if (!resettingMfa) return;
          try {
            await resetMfa.mutateAsync(resettingMfa.uuid);
            await forceLogout.mutateAsync(resettingMfa.uuid);
            toast.success("MFA reset", "They must sign in again.");
            setResettingMfa(null);
          } catch (err) {
            toast.error(
              "Could not reset MFA",
              err && typeof err === "object" && "userMessage" in err
                ? (err as { userMessage: () => string }).userMessage()
                : "Please try again.",
            );
          }
        }}
      />
    </>
  );
}
