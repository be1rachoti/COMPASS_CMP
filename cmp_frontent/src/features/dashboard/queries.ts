/**
 * The role-aware dashboard payload.
 */
"use client";

import { useQuery } from "@tanstack/react-query";

import { getDashboard } from "@/features/dashboard/api";
import type { ApiError } from "@/lib/errors";
import { keys } from "@/lib/query";
import type { DashboardData } from "@/types";

export function useDashboard() {
  return useQuery<DashboardData, ApiError>({
    queryKey: keys.dashboard.all,
    queryFn: () => getDashboard(),
  });
}
