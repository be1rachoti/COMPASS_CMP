/**
 * The small shared types and helpers every feature's hooks are written against.
 *
 * Kept here rather than in each feature so that a change to how the console
 * talks to TanStack Query is one edit, not nineteen.
 */
"use client";

import { useMutation } from "@tanstack/react-query";
import type {
  UseMutationOptions,
  UseMutationResult,
  UseQueryOptions,
} from "@tanstack/react-query";

import { apiPost, apiPut } from "@/lib/api";
import type { ApiError } from "@/lib/errors";

/**
 * What a caller may override on a query hook.
 *
 * `queryKey` and `queryFn` are omitted on purpose: those are the hook's own
 * decision. Letting a component supply its own key would put a second, private
 * copy of the cache next to the shared one, and invalidation would reach only
 * one of them.
 */
export type Options<T> = Omit<UseQueryOptions<T, ApiError>, "queryKey" | "queryFn">;

/**
 * Filters shared by the cross-project console listings.
 *
 * The per-project endpoints answer "what does this project have". These answer
 * "what is outstanding anywhere", which is what each nav section asks and what
 * cannot be assembled client-side without one request per project.
 */
export interface ListFilters extends Record<string, unknown> {
  status?: string;
  project?: string;
  type?: string;
  q?: string;
  limit?: number;
  cursor?: string;
  sort?: string;
}

/**
 * A write with no cache consequences worth naming.
 *
 * Most mutations need to invalidate something specific and are written out in
 * full in their feature's `mutations.ts`. This is for the handful that do not —
 * a verification, a re-send — where spelling out a bespoke hook adds nothing.
 */
export function useApiMutation<TData, TVariables>(
  path: string | ((vars: TVariables) => string),
  method: "post" | "put" = "post",
  options?: UseMutationOptions<TData, ApiError, TVariables>,
) {
  return useMutation<TData, ApiError, TVariables>({
    mutationFn: (vars) => {
      const url = typeof path === "function" ? path(vars) : path;
      return method === "put" ? apiPut<TData>(url, vars) : apiPost<TData>(url, vars);
    },
    ...options,
  });
}

/**
 * What a mutation hook returns.
 *
 * Named because the full `UseMutationResult<TData, ApiError, TVars>` appears in
 * every write hook's signature, and the middle parameter — the error type — is
 * the part that matters: it is always `ApiError`, never `Error`, so a caller
 * reading `.error` gets `fieldErrors` and `isForbidden` without a cast.
 */
export type Result<TData, TVars> = UseMutationResult<TData, ApiError, TVars>;
