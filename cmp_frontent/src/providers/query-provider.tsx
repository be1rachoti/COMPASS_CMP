/**
 * TanStack Query configuration.
 *
 * The defaults are chosen for compliance data, which behaves differently from
 * the content most query defaults are tuned for:
 *
 * - **Short stale time.** A consent count that is thirty seconds out of date is
 *   a wrong answer, not a slow one. Thirty seconds is the compromise between
 *   that and hammering the API on every focus change.
 * - **Never retry a 4xx.** A 403 will still be a 403 on the fourth attempt; all
 *   retrying achieves is three more audited access denials in the DPO's log.
 * - **Never retry a mutation.** These are writes to an append-only store. A
 *   retried export would write a second set of `export_line` rows and corrupt
 *   the disclosure record.
 */
"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as React from "react";

import { ApiError } from "@/lib/api-error";
import { config } from "@/lib/config";

export function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: config.staleTimeMs,
        gcTime: 5 * 60_000,
        refetchOnWindowFocus: true,
        refetchOnReconnect: true,
        retry: (failureCount, error) => {
          if (error instanceof ApiError && !error.isTransient) return false;
          return failureCount < 2;
        },
        retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
      },
      mutations: {
        retry: false,
      },
    },
  });
}

export function QueryProvider({ children }: { children: React.ReactNode }) {
  // One client per browser session, created lazily. Creating it at module scope
  // would share cached data between users on a server render.
  const [client] = React.useState(makeQueryClient);

  return (
    <QueryClientProvider client={client}>
      {children}
      {!config.isProduction && <Devtools />}
    </QueryClientProvider>
  );
}

/** Devtools are dev-only and lazily loaded, so they never reach a production bundle. */
function Devtools() {
  const [Panel, setPanel] = React.useState<React.ComponentType | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    void import("@tanstack/react-query-devtools").then((mod) => {
      if (cancelled) return;
      // Named, so React DevTools shows something more useful than "Anonymous"
      // and the lint rule that requires it is satisfied for a real reason.
      const Devtools = () => <mod.ReactQueryDevtools initialIsOpen={false} />;
      Devtools.displayName = "ReactQueryDevtoolsPanel";
      setPanel(() => Devtools);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return Panel ? <Panel /> : null;
}
