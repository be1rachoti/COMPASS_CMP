/**
 * Administering user accounts, roles and sessions.
 */
"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";

import {
  changeUserRole,
  createUser,
  deactivateUser,
  forceLogout,
  reactivateUser,
  resetMfa,
  updateUser,
  type UserInput,
} from "@/features/users/api";
import type { ApiError } from "@/lib/errors";
import { keys, type Result } from "@/lib/query";
import type { Acknowledged, User, Uuid } from "@/types";

export function useDeactivateUser() {
  const qc = useQueryClient();
  return useMutation<Acknowledged, ApiError, Uuid>({
    mutationFn: deactivateUser,
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.users.list() }),
  });
}

export function useReactivateUser() {
  const qc = useQueryClient();
  return useMutation<Acknowledged, ApiError, Uuid>({
    mutationFn: reactivateUser,
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.users.list() }),
  });
}

export function useCreateUser(): Result<User, UserInput> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createUser,
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.users.list() }),
  });
}

export function useUpdateUser(uuid: Uuid): Result<User, Partial<UserInput>> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Partial<UserInput>) => updateUser(uuid, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.users.list() }),
  });
}

export function useChangeRole(
  uuid: Uuid,
): Result<Acknowledged, { role: string; reason?: string }> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { role: string; reason?: string }) => changeUserRole(uuid, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.users.list() }),
  });
}

export function useResetMfa(): Result<Acknowledged, Uuid> {
  return useMutation({
    mutationFn: resetMfa,
  });
}

/**
 * End every session this user holds.
 *
 * The response to a lost laptop, so it deliberately does not invalidate the
 * user list: nothing about the account row changed, and refetching would
 * suggest to the administrator that something did.
 */
export function useForceLogout(): Result<Acknowledged, Uuid> {
  return useMutation({ mutationFn: forceLogout });
}
