/**
 * Provider composition.
 *
 * Order matters and is not arbitrary:
 *
 *   ErrorBoundary -> QueryProvider -> ToastProvider -> AuthProvider
 *
 * `AuthProvider` calls `useQueryClient`, so it must sit inside the query client.
 * The error boundary is outermost so a crash in any provider still renders a
 * recovery screen instead of a blank page.
 */
"use client";

import * as React from "react";

import { AuthProvider } from "./auth-provider";
import { QueryProvider } from "./query-provider";
import { ThemeProvider } from "./theme-provider";
import { ToastProvider } from "./toast-provider";
import { AppErrorBoundary } from "@/components/feedback/error-boundary";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <AppErrorBoundary>
      <QueryProvider>
        <ThemeProvider>
          <ToastProvider>
            <AuthProvider>{children}</AuthProvider>
          </ToastProvider>
        </ThemeProvider>
      </QueryProvider>
    </AppErrorBoundary>
  );
}

export { useAuth, RequireAuth } from "./auth-provider";
export { useToast } from "./toast-provider";
export { useTheme } from "./theme-provider";
