/**
 * Toasts.
 *
 * Deliberately minimal, and deliberately not the place errors go to die. A toast
 * is for confirming something that happened; a failure that needs a decision
 * belongs inline, next to the control that caused it, where the user is looking.
 *
 * The region is a polite live region so a screen reader announces it without
 * interrupting, and each toast is dismissible - an auto-dismiss that is the only
 * way to read a message excludes anyone who reads slowly.
 */
"use client";

import { AlertTriangle, CheckCircle2, Info, X, XCircle } from "lucide-react";
import * as React from "react";

import { cn } from "@/lib/utils";

export type ToastTone = "success" | "error" | "info" | "warning";

export interface Toast {
  id: string;
  tone: ToastTone;
  title: string;
  description?: string;
  /** Milliseconds. 0 keeps it until dismissed - used for anything with detail
   *  worth reading, such as a request id. */
  duration?: number;
}

interface ToastContextValue {
  toasts: Toast[];
  push: (toast: Omit<Toast, "id">) => string;
  dismiss: (id: string) => void;
  success: (title: string, description?: string) => string;
  error: (title: string, description?: string) => string;
  info: (title: string, description?: string) => string;
  warning: (title: string, description?: string) => string;
}

const ToastContext = React.createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const ctx = React.useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>");
  return ctx;
}

const TONE_STYLES: Record<ToastTone, string> = {
  success: "border-success-border bg-success-subtle text-success-text",
  error: "border-danger-border bg-danger-subtle text-danger-text",
  warning: "border-warning-border bg-warning-subtle text-warning-text",
  info: "border-info-border bg-info-subtle text-info-text",
};

/** An icon per tone, so the meaning is not carried by colour alone. */
const TONE_ICONS: Record<ToastTone, React.ComponentType<{ className?: string }>> = {
  success: CheckCircle2,
  error: XCircle,
  warning: AlertTriangle,
  info: Info,
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<Toast[]>([]);
  const timers = React.useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const dismiss = React.useCallback((id: string) => {
    setToasts((current) => current.filter((t) => t.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const push = React.useCallback(
    (toast: Omit<Toast, "id">) => {
      const id = crypto.randomUUID();
      // Errors default to staying: they usually carry a request id somebody
      // needs to copy, and four seconds is not long enough to do that.
      const duration = toast.duration ?? (toast.tone === "error" ? 0 : 4500);

      setToasts((current) => [...current.slice(-3), { ...toast, id }]);

      if (duration > 0) {
        timers.current.set(
          id,
          setTimeout(() => dismiss(id), duration),
        );
      }
      return id;
    },
    [dismiss],
  );

  React.useEffect(() => {
    const pending = timers.current;
    return () => {
      pending.forEach(clearTimeout);
      pending.clear();
    };
  }, []);

  const value = React.useMemo<ToastContextValue>(
    () => ({
      toasts,
      push,
      dismiss,
      success: (title, description) => push({ tone: "success", title, description }),
      error: (title, description) => push({ tone: "error", title, description }),
      info: (title, description) => push({ tone: "info", title, description }),
      warning: (title, description) => push({ tone: "warning", title, description }),
    }),
    [toasts, push, dismiss],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        role="region"
        aria-label="Notifications"
        aria-live="polite"
        className="fixed bottom-4 right-4 z-50 flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2 no-print"
      >
        {toasts.map((toast) => {
          const Icon = TONE_ICONS[toast.tone];
          return (
          <div
            key={toast.id}
            className={cn(
              "toast-in rounded-xl border px-4 py-3 shadow-[var(--shadow-pop)]",
              TONE_STYLES[toast.tone],
            )}
          >
            <div className="flex items-start gap-3">
              <Icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">{toast.title}</p>
                {toast.description && (
                  <p className="mt-0.5 text-xs leading-relaxed opacity-90 break-words">
                    {toast.description}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => dismiss(toast.id)}
                className="shrink-0 rounded-md p-0.5 opacity-60 transition-opacity hover:opacity-100"
                aria-label={`Dismiss: ${toast.title}`}
              >
                <X className="size-4" />
              </button>
            </div>
          </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}
