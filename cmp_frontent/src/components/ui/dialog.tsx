/**
 * Modal dialog.
 *
 * Radix rather than a hand-rolled overlay, because the parts that are easy to
 * skip are the parts that matter: focus is trapped inside while open and
 * restored to the trigger on close, Escape dismisses, the rest of the page is
 * inert to screen readers, and the title is wired to `aria-labelledby`. A modal
 * missing any of those is unusable without a mouse.
 */
"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import * as React from "react";

import { Button } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export function DialogContent({
  className,
  children,
  title,
  description,
  size = "md",
  ...props
}: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
  title: string;
  description?: string;
  size?: "sm" | "md" | "lg";
}) {
  const widths = {
    sm: "max-w-md",
    md: "max-w-xl",
    lg: "max-w-3xl",
  };

  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay
        className="overlay-in fixed inset-0 z-40 bg-black/50 backdrop-blur-[3px]"
      />
      <DialogPrimitive.Content
        className={cn(
          "dialog-in fixed left-1/2 top-1/2 z-50 w-[calc(100vw-2rem)]",
          widths[size],
          "rounded-2xl border border-border bg-surface shadow-[var(--shadow-pop)]",
          // A tall form must scroll inside the dialog, not push the page.
          "max-h-[calc(100dvh-4rem)] overflow-y-auto",
          className,
        )}
        {...props}
      >
        <div className="glass sticky top-0 z-10 flex items-start justify-between gap-4 rounded-t-2xl border-b border-border px-5 py-4">
          <div className="min-w-0">
            <DialogPrimitive.Title className="text-base font-semibold">
              {title}
            </DialogPrimitive.Title>
            {description ? (
              <DialogPrimitive.Description className="mt-1 text-sm text-text-muted">
                {description}
              </DialogPrimitive.Description>
            ) : (
              // Radix warns when Content has no Description. An explicit empty
              // one is clearer than suppressing the warning.
              <DialogPrimitive.Description className="sr-only">
                {title}
              </DialogPrimitive.Description>
            )}
          </div>
          <DialogPrimitive.Close
            className="shrink-0 rounded-lg p-1.5 text-text-subtle transition-colors hover:bg-bg-inset hover:text-text"
            aria-label="Close"
          >
            <X className="size-4" />
          </DialogPrimitive.Close>
        </div>

        <div className="px-5 py-4">{children}</div>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export function DialogFooter({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-5 flex flex-wrap items-center justify-end gap-2 border-t border-border pt-4">
      {children}
    </div>
  );
}

/**
 * Confirmation for an action that cannot be undone.
 *
 * Separate from the generic dialog on purpose: destructive actions get a named
 * consequence and a button labelled with the verb, never "OK". "OK" gives the
 * user nothing to check their intent against.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  consequence,
  confirmLabel,
  onConfirm,
  loading,
  tone = "danger",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  consequence: React.ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  loading?: boolean;
  tone?: "danger" | "primary";
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={title} size="sm">
        <div className="text-sm leading-relaxed text-text-muted">{consequence}</div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant={tone} loading={loading} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
