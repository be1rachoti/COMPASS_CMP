/**
 * Reading the user directory.
 */
"use client";

import { useQuery } from "@tanstack/react-query";

import { listUsers } from "@/features/users/api";
import type { ApiError } from "@/lib/errors";
import { keys } from "@/lib/query";
import type { Page, User } from "@/types";

export function useUsers(filters: Record<string, unknown> = {}) {
  return useQuery<Page<User>, ApiError>({
    queryKey: keys.users.list(filters),
    queryFn: () => listUsers(filters),
  });
}
