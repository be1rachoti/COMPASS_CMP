/**
 * The notification feed.
 */
"use client";

import { useQuery } from "@tanstack/react-query";

import { listNotifications } from "@/features/notifications/api";
import type { ApiError } from "@/lib/errors";
import { keys } from "@/lib/query";
import type { AuditEntry } from "@/types";

/**
 * The notification feed.
 *
 * Typed as audit entries because that is exactly what they are — the endpoint
 * derives the feed from the trail rather than keeping a second table that could
 * disagree with it. Typing it as such is what lets the same detail renderer
 * serve both surfaces.
 */
export function useNotifications(limit = 50) {
  return useQuery<{ items: AuditEntry[]; total: number }, ApiError>({
    queryKey: keys.notifications.all,
    queryFn: () => listNotifications(limit),
  });
}
