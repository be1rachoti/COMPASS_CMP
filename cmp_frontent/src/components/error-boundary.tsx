/**
 * Error boundary.
 *
 * A render error in one panel should not blank the page. This catches it, shows
 * something recoverable, and - importantly - does not print the stack to the
 * user. The stack goes to the console and, in a real deployment, to whatever
 * error tracker is wired into `onError`.
 *
 * Class component because React still offers no hook equivalent of
 * `componentDidCatch`.
 */
"use client";

import { AlertTriangle, RotateCcw } from "lucide-react";
import * as React from "react";

import { Button } from "@/components/ui/primitives";
import { ApiError } from "@/lib/api-error";

interface Props {
  children: React.ReactNode;
  /** Rendered instead of the default panel. */
  fallback?: (error: Error, reset: () => void) => React.ReactNode;
}

interface State {
  error: Error | null;
}

export class AppErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    // Replace with Sentry.captureException(error, { extra: info }) in a
    // deployment. Kept as console here so the dev loop is unchanged and no
    // third-party SDK ships by default.
    console.error("Unhandled render error", error, info.componentStack);
  }

  reset = (): void => this.setState({ error: null });

  render(): React.ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    if (this.props.fallback) return this.props.fallback(error, this.reset);

    // An API error that reached the boundary still carries the request id, which
    // is the one piece of detail worth showing: it is what support will ask for.
    const requestId = error instanceof ApiError ? error.requestId : null;

    return (
      <div className="flex min-h-[60vh] items-center justify-center px-6">
        <div className="max-w-md text-center">
          <AlertTriangle className="mx-auto size-8 text-warning" aria-hidden="true" />
          <h1 className="mt-4 text-lg font-semibold">Something went wrong</h1>
          <p className="mt-2 text-sm text-text-muted">
            This part of the page failed to render. Your data has not been
            changed.
          </p>
          {requestId && (
            <p className="mt-3 font-mono text-xs text-text-subtle">
              Reference: {requestId}
            </p>
          )}
          <div className="mt-5 flex justify-center gap-2">
            <Button onClick={this.reset} variant="primary">
              <RotateCcw className="size-4" />
              Try again
            </Button>
            <Button variant="secondary" onClick={() => window.location.reload()}>
              Reload the page
            </Button>
          </div>
        </div>
      </div>
    );
  }
}
