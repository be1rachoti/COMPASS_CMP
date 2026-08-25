/**
 * Administering user accounts, roles and sessions.
 */
"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiPost, apiPatch, http } from "@/lib/api";
import type { ApiError } from "@/lib/errors";
import type { Result } from "@/lib/query";
import type { Acknowledged, User, Uuid } from "@/types";

export function useDeactivateUser() {
  const qc = useQueryClient();
  return useMutation<{ ok: boolean; message?: string }, ApiError, Uuid>({
    mutationFn: (uuid) => apiPost(`/users/${uuid}/deactivate`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["users"] }),
  });
}

export function useReactivateUser() {
  const qc = useQueryClient();
  return useMutation<{ ok: boolean; message?: string }, ApiError, Uuid>({
    mutationFn: (uuid) => apiPost(`/users/${uuid}/reactivate`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["users"] }),
  });
}

export interface UserInput {
  full_name: string;
  email: string;
  role: string;
  username?: string | null;
  mobile?: string | null;
  organization_id?: string | null;
  person_type?: string | null;
}

export function useCreateUser(): Result<User, UserInput> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body) => apiPost<User>("/users", body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["users"] }),
  });
}

export function useUpdateUser(uuid: Uuid): Result<User, Partial<UserInput>> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body) => apiPatch<User>(`/users/${uuid}`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["users"] }),
  });
}

export function useChangeRole(
  uuid: Uuid,
): Result<Acknowledged, { role: string; reason?: string }> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body) => apiPost<Acknowledged>(`/users/${uuid}/role`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["users"] }),
  });
}

export function useResetMfa(): Result<Acknowledged, Uuid> {
  return useMutation({
    mutationFn: (uuid) => apiPost<Acknowledged>(`/users/${uuid}/mfa/reset`),
  });
}

export function useForceLogout(): Result<Acknowledged, Uuid> {
  return useMutation({
    mutationFn: async (uuid) => {
      const { data } = await http.delete<Acknowledged>(`/users/${uuid}/sessions`);
      return data;
    },
  });
}
