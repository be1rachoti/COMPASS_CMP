/**
 * The signed-in user's own sessions.
 */
"use client";

import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api";
import type { ApiError } from "@/lib/errors";
import type { SessionInfo } from "@/types";

export function useSessions() {
  return useQuery<SessionInfo[], ApiError>({
    queryKey: ["auth", "sessions"],
    queryFn: () => apiGet<SessionInfo[]>("/auth/sessions"),
  });
}
