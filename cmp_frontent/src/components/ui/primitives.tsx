/**
 * The component library.
 *
 * Small, composable, and typed. Every visual decision comes from the tokens in
 * `globals.css`; nothing here hardcodes a colour or a spacing value, which is
 * what lets the whole product change theme in one file.
 *
 * Accessibility is not a separate pass. Buttons announce their busy state,
 * inputs are always associated with a label, errors are wired through
 * `aria-describedby`, and every icon-only control carries a name.
 */
"use client";

import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import { cn } from "@/lib/utils";

/* ==================================================================== Button */
const buttonVariants = cva(
  cn(
    "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg",
    "font-medium select-none",
    // Transform is in the transition so the press reads as physical. The active
    // state sinks 1px rather than changing colour: a finger expects the surface
    // to move under it.
    "transition-[background-color,border-color,color,box-shadow,transform,filter] duration-150",
    "active:translate-y-px",
    "disabled:pointer-events-none disabled:opacity-50 disabled:active:translate-y-0",
    "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg]:size-4",
  ),
  {
    variants: {
      variant: {
        // The gradient is the product's one branded surface. Reserved for the
        // single primary action on a screen - two of these and neither leads.
        primary:
          "brand-gradient text-white shadow-[var(--shadow-sm)] hover:shadow-[var(--shadow-glow)] hover:brightness-110",
        secondary:
          "bg-surface text-text border border-border-strong shadow-[var(--shadow-sm)] hover:bg-surface-hover hover:border-text-subtle",
        ghost: "text-text-muted hover:bg-bg-inset hover:text-text",
        danger: "bg-danger text-white shadow-[var(--shadow-sm)] hover:brightness-110",
        // For the one destructive action on a page: reads as a link until
        // hovered, so it does not compete with the primary action.
        subtle: "text-danger-text hover:bg-danger-subtle",
        link: "text-accent-text underline-offset-4 hover:underline",
      },
      size: {
        sm: "h-8 px-3 text-xs",
        md: "h-9.5 px-4 text-sm",
        lg: "h-11 px-6 text-base",
        icon: "size-9",
      },
    },
    defaultVariants: { variant: "secondary", size: "md" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  /** Shows a spinner and blocks interaction. Prefer this to disabling the
   *  button silently - a control that stops responding with no explanation
   *  reads as broken. */
  loading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild, loading, children, disabled, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        ref={ref}
        className={cn(buttonVariants({ variant, size }), className)}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        {...props}
      >
        {loading ? (
          <>
            <Spinner className="size-4" />
            <span>{children}</span>
          </>
        ) : (
          children
        )}
      </Comp>
    );
  },
);
Button.displayName = "Button";

export function Spinner({ className }: { className?: string }) {
  return (
    <svg
      className={cn("animate-spin", className)}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" />
      <path
        d="M12 2a10 10 0 0 1 10 10"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}

/* ====================================================================== Card */
export function Card({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-xl border border-border bg-surface shadow-[var(--shadow-card)]",
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("px-5 py-4 border-b border-border", className)} {...props} />;
}

export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h2 className={cn("text-base font-semibold", className)} {...props} />;
}

export function CardDescription({
  className,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("mt-1 text-sm text-text-muted", className)} {...props} />;
}

export function CardBody({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("p-5", className)} {...props} />;
}

export function CardFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "px-5 py-3 border-t border-border bg-bg-subtle rounded-b-xl flex items-center gap-2",
        className,
      )}
      {...props}
    />
  );
}

/* ===================================================================== Badge */
const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium",
  {
    variants: {
      tone: {
        neutral: "bg-bg-inset text-text-muted border-border",
        accent: "bg-accent-subtle text-accent-text border-accent-border",
        success: "bg-success-subtle text-success-text border-success-border",
        warning: "bg-warning-subtle text-warning-text border-warning-border",
        danger: "bg-danger-subtle text-danger-text border-danger-border",
        info: "bg-info-subtle text-info-text border-info-border",
      },
    },
    defaultVariants: { tone: "neutral" },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {
  /** A coloured dot in front of the label.
   *
   *  Colour alone never carries the meaning - the label is always present - so
   *  the badge stays readable for someone who cannot distinguish the hues.
   */
  dot?: boolean;
}

export function Badge({ className, tone, dot, children, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ tone }), className)} {...props}>
      {dot && <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />}
      {children}
    </span>
  );
}

/* ===================================================================== Input */
export interface FieldProps {
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: (props: {
    id: string;
    "aria-invalid": boolean | undefined;
    "aria-describedby": string | undefined;
  }) => React.ReactNode;
}

/**
 * Label, control, hint and error as one unit.
 *
 * The wiring is the point: `htmlFor`/`id` associate the label, and
 * `aria-describedby` points at whichever of hint/error is present, so a screen
 * reader announces the requirement and the failure rather than just "edit box".
 */
export function Field({ label, hint, error, required, children }: FieldProps) {
  const id = React.useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [errorId, hintId].filter(Boolean).join(" ") || undefined;

  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium text-text">
        {label}
        {required && (
          <span className="text-danger ml-0.5" aria-label="required">
            *
          </span>
        )}
      </label>
      {children({ id, "aria-invalid": error ? true : undefined, "aria-describedby": describedBy })}
      {error ? (
        <p id={errorId} role="alert" className="text-xs text-danger-text">
          {error}
        </p>
      ) : hint ? (
        <p id={hintId} className="text-xs text-text-subtle">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

const controlBase = cn(
  "w-full rounded-lg border bg-surface px-3 text-sm text-text",
  "placeholder:text-text-subtle",
  // The inset hairline is what makes a field read as a well rather than a card.
  "border-border-strong shadow-[inset_0_1px_2px_rgb(0_0_0/0.03)]",
  // A ring on focus, not a colour swap: it survives any background and, unlike a
  // border-width change, moves nothing on the page.
  "focus:border-accent focus:ring-2 focus:ring-[var(--accent-subtle)] focus:outline-none",
  "disabled:cursor-not-allowed disabled:bg-bg-inset disabled:opacity-60",
  "aria-[invalid=true]:border-danger aria-[invalid=true]:ring-2 aria-[invalid=true]:ring-[var(--danger-subtle)]",
  "transition-[border-color,box-shadow] duration-150",
);

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input ref={ref} className={cn(controlBase, "h-10", className)} {...props} />
  ),
);
Input.displayName = "Input";

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea ref={ref} className={cn(controlBase, "py-2 min-h-24 leading-relaxed", className)} {...props} />
));
Textarea.displayName = "Textarea";

export const Select = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(({ className, ...props }, ref) => (
  <select ref={ref} className={cn(controlBase, "h-10 pr-8", className)} {...props} />
));
Select.displayName = "Select";

/* ===================================================================== Alert */
const alertVariants = cva("rounded-lg border px-4 py-3 text-sm shadow-[var(--shadow-sm)]", {
  variants: {
    tone: {
      info: "bg-info-subtle border-info-border text-info-text",
      success: "bg-success-subtle border-success-border text-success-text",
      warning: "bg-warning-subtle border-warning-border text-warning-text",
      danger: "bg-danger-subtle border-danger-border text-danger-text",
    },
  },
  defaultVariants: { tone: "info" },
});

export interface AlertProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof alertVariants> {
  title?: string;
}

export function Alert({ className, tone, title, children, ...props }: AlertProps) {
  return (
    <div
      // Errors interrupt; everything else waits for a pause. Making every alert
      // assertive trains people to ignore the assertive ones.
      role={tone === "danger" ? "alert" : "status"}
      className={cn(alertVariants({ tone }), className)}
      {...props}
    >
      {title && <p className="font-semibold mb-1">{title}</p>}
      <div className="[&_p]:leading-relaxed">{children}</div>
    </div>
  );
}

/* ================================================================== Skeleton */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn("shimmer rounded-md", className)}
      aria-hidden="true"
      data-testid="skeleton"
    />
  );
}

/**
 * Loading placeholder for a table.
 *
 * Matched to the real row height so the layout does not jump when data arrives -
 * a shift at the moment someone reaches for a control makes them click the wrong
 * thing.
 */
export function TableSkeleton({ rows = 5, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div className="space-y-px" aria-hidden="true">
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex gap-4 px-4 py-3">
          {Array.from({ length: cols }).map((_, c) => (
            <Skeleton key={c} className={cn("h-4", c === 0 ? "w-1/3" : "flex-1")} />
          ))}
        </div>
      ))}
    </div>
  );
}

/* ================================================================ EmptyState */
export function EmptyState({
  icon,
  illustration,
  title,
  description,
  action,
}: {
  icon?: React.ReactNode;
  /** An illustration from `ui/graphics`. Preferred over a bare icon: the empty
   *  screen is where a product either looks considered or looks unfinished. */
  illustration?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="relative flex flex-col items-center justify-center overflow-hidden px-6 py-14 text-center">
      <span aria-hidden="true" className="grid-texture absolute inset-0" />
      <div className="relative">
        {illustration ? (
          <div className="mb-4 flex justify-center">{illustration}</div>
        ) : icon ? (
          <div className="mb-3 flex justify-center text-text-subtle [&_svg]:size-8">{icon}</div>
        ) : null}
        <p className="text-sm font-medium text-text">{title}</p>
        {description && (
          <p className="mx-auto mt-1 max-w-sm text-sm text-text-muted">{description}</p>
        )}
        {action && <div className="mt-4">{action}</div>}
      </div>
    </div>
  );
}

/* ===================================================================== Table */
export function Table({ className, ...props }: React.TableHTMLAttributes<HTMLTableElement>) {
  return (
    <div className="scroll-x rounded-xl border border-border bg-surface shadow-[var(--shadow-card)]">
      <table className={cn("w-full text-sm", className)} {...props} />
    </div>
  );
}

export function Th({ className, ...props }: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      scope="col"
      className={cn(
        "px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide",
        "text-text-subtle border-b border-border bg-bg-subtle whitespace-nowrap",
        "first:rounded-tl-xl last:rounded-tr-xl",
        className,
      )}
      {...props}
    />
  );
}

export function Td({ className, ...props }: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td className={cn("px-4 py-3 border-b border-border align-middle", className)} {...props} />
  );
}

export function Tr({ className, ...props }: React.HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr
      className={cn(
        "transition-colors hover:bg-surface-hover",
        // The last row's own border would double the container's.
        "last:[&>td]:border-b-0",
        className,
      )}
      {...props}
    />
  );
}

/* ====================================================== Definition list ==== */
export function DescriptionList({ children }: { children: React.ReactNode }) {
  return <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-[minmax(9rem,auto)_1fr]">{children}</dl>;
}

export function DescriptionItem({
  term,
  children,
}: {
  term: string;
  children: React.ReactNode;
}) {
  return (
    <>
      <dt className="text-sm text-text-muted">{term}</dt>
      <dd className="text-sm text-text break-words">{children}</dd>
    </>
  );
}

/* ================================================================= Monospace */
/** For hashes, uuids and tokens: things that are compared character by character. */
export function Mono({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn("font-mono text-xs text-text-muted break-all", className)}
      {...props}
    />
  );
}
