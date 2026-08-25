/**
 * The chart vocabulary.
 *
 * Built by the method rather than by taste: the data's job picks the form, and
 * colour comes last. Two of these are deliberately *not* charts — a single
 * current value is a stat tile, and a ratio against a limit is a meter. A
 * one-bar bar chart says nothing a number does not.
 *
 * The three-hue palette in `globals.css` was checked with the dataviz
 * validator: all six checks pass in both modes, worst adjacent normal-vision
 * ΔE 24.0 light / 20.9 dark against a ≥15 floor. Two hues sit below 3:1 against
 * the surface, which obligates visible labels — so every segment here is
 * direct-labelled and every series is named in text. Identity never rests on
 * colour alone.
 */
"use client";

import { ArrowRight } from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { cn } from "@/lib/format";

/* ========================================================== stat tile / KPI */

/**
 * A single current value. The right form for one number, per the form
 * heuristic — a one-bar chart would carry the same information and less of it.
 */
export function StatTile({
  label,
  value,
  hint,
  tone = "neutral",
  icon,
  href,
  className,
}: {
  label: string;
  value: number | string;
  hint?: string;
  /** `attention` is for a count that is a problem when non-zero. */
  tone?: "neutral" | "accent" | "attention";
  icon?: React.ReactNode;
  /** Where the rows behind this figure live. A number somebody wants to act on
   *  and cannot click is a dead end — the tile becomes a link when given one. */
  href?: string;
  className?: string;
}) {
  const shown = typeof value === "number" ? value.toLocaleString("en-IN") : value;

  // Branched rather than a polymorphic `Wrapper`: next/link's href is required,
  // so a component variable typed as `Link | "div"` cannot accept an optional
  // one without casting the type away.
  const classes = cn(
    "lift group relative block overflow-hidden rounded-xl border bg-surface p-4",
    "shadow-[var(--shadow-card)]",
    tone === "attention" ? "border-warning-border" : "border-border",
    href &&
      "cursor-pointer hover:border-accent-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-subtle)]",
    className,
  );

  const body = (
    <>
      {/* A hairline of colour along the top edge. Enough to group the tile with
          its meaning, not enough to compete with the figure. */}
      <span
        aria-hidden="true"
        className={cn(
          "absolute inset-x-0 top-0 h-0.5",
          tone === "attention"
            ? "bg-warning"
            : tone === "accent"
              ? "brand-gradient"
              : "bg-border",
        )}
      />

      <div className="flex items-start justify-between gap-3">
        <p className="text-2xs font-semibold uppercase tracking-wider text-text-subtle">
          {label}
        </p>
        {icon && (
          <span
            aria-hidden="true"
            className={cn(
              "grid size-7 shrink-0 place-items-center rounded-lg [&_svg]:size-3.5",
              tone === "attention"
                ? "bg-warning-subtle text-warning-text"
                : "bg-bg-inset text-text-subtle group-hover:bg-accent-subtle group-hover:text-accent-text",
              "transition-colors",
            )}
          >
            {icon}
          </span>
        )}
      </div>

      <p
        className={cn(
          "mt-1.5 text-2xl font-semibold tabular tracking-tight",
          tone === "attention" ? "text-warning-text" : "text-text",
        )}
      >
        {shown}
      </p>

      {hint && <p className="mt-0.5 text-xs text-text-muted">{hint}</p>}

      {href && (
        <span
          aria-hidden="true"
          className="absolute bottom-3 right-3 text-text-subtle opacity-0 transition-opacity group-hover:opacity-100"
        >
          <ArrowRight className="size-4" />
        </span>
      )}
    </>
  );

  return href ? (
    <Link href={href} className={classes}>
      {body}
    </Link>
  ) : (
    <div className={classes}>{body}</div>
  );
}

/* ==================================================================== meter */

/**
 * A single ratio against a limit. Same-ramp track, never a two-slice pie.
 *
 * Used for a consent link's use cap, where the question is "how much of the
 * allowance is gone" — one value against one limit.
 */
export function Meter({
  label,
  value,
  max,
  caption,
}: {
  label: string;
  value: number;
  max: number;
  caption?: string;
}) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  // Amber past 80%: the point at which somebody should be thinking about the
  // cap, not the point at which it is already too late.
  const tight = pct >= 80;

  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm text-text-muted">{label}</span>
        <span className="text-sm font-medium tabular text-text">
          {value.toLocaleString("en-IN")}
          <span className="text-text-subtle"> / {max.toLocaleString("en-IN")}</span>
        </span>
      </div>

      <div
        className="mt-1.5 h-2 overflow-hidden rounded-full bg-[var(--viz-track)]"
        role="meter"
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-label={label}
      >
        <div
          className={cn("grow-x h-full rounded-full", tight ? "bg-warning" : "bg-[var(--viz-2)]")}
          style={{ width: `${pct}%` }}
        />
      </div>

      {caption && <p className="mt-1 text-xs text-text-subtle">{caption}</p>}
    </div>
  );
}

/* ====================================================== stacked composition */

export interface Segment {
  key: string;
  label: string;
  value: number;
  /** A CSS colour, taken from the validated `--viz-*` slots. */
  color: string;
}

/**
 * Part-to-whole, horizontal.
 *
 * Horizontal because the category names are words ("Consented", "Withdrawn"),
 * and horizontal is what lets them be read without rotating anything.
 *
 * A 2px surface gap sits between segments so adjacent fills never touch — that
 * gap is what keeps two similar hues separable, and it is why the palette
 * validates on the *adjacent* pairlist rather than all pairs.
 */
export function StackedBar({
  segments,
  total,
  caption,
}: {
  segments: Segment[];
  total?: number;
  caption?: string;
}) {
  const sum = total ?? segments.reduce((acc, s) => acc + s.value, 0);
  const present = segments.filter((s) => s.value > 0);

  if (sum === 0) {
    return (
      <div>
        <div className="h-3 rounded-full bg-[var(--viz-track)]" aria-hidden="true" />
        <p className="mt-2 text-xs text-text-subtle">
          {caption ?? "Nothing recorded yet."}
        </p>
      </div>
    );
  }

  return (
    <div>
      <div
        className="flex h-3 gap-0.5 overflow-hidden rounded-full"
        role="img"
        aria-label={`${caption ?? "Composition"}: ${present
          .map((s) => `${s.label} ${s.value}`)
          .join(", ")}`}
      >
        {present.map((s) => (
          <div
            key={s.key}
            className="grow-x h-full first:rounded-l-full last:rounded-r-full"
            style={{ width: `${(s.value / sum) * 100}%`, background: s.color }}
          />
        ))}
      </div>

      {/* The legend is also the direct labelling. Every segment is named with
          its count, so the contrast WARN on two of the hues is covered and
          nobody has to match a colour to a key. */}
      <ul className="mt-3 grid gap-x-5 gap-y-1.5 sm:grid-cols-2">
        {segments.map((s) => (
          <li key={s.key} className="flex items-center gap-2 text-sm">
            <span
              aria-hidden="true"
              className="size-2.5 shrink-0 rounded-[3px]"
              style={{ background: s.color }}
            />
            {/* Text wears text tokens, never the series colour. */}
            <span className="text-text-muted">{s.label}</span>
            <span className="ml-auto font-medium tabular text-text">
              {s.value.toLocaleString("en-IN")}
            </span>
            <span className="w-10 text-right text-xs tabular text-text-subtle">
              {sum > 0 ? `${Math.round((s.value / sum) * 100)}%` : "—"}
            </span>
          </li>
        ))}
      </ul>

      {caption && <p className="mt-3 text-xs text-text-subtle">{caption}</p>}
    </div>
  );
}

/* ==================================================== ranked magnitude bars */

/**
 * Compare magnitude across a handful of named things.
 *
 * One hue, more-is-longer — sequential is the safe default when the job is
 * magnitude rather than identity, and it cannot be misread the way eight
 * categorical hues can.
 */
export function BarList({
  items,
  emptyLabel = "Nothing to show",
}: {
  items: Array<{ key: string; label: string; value: number; href?: string }>;
  emptyLabel?: string;
}) {
  const max = Math.max(1, ...items.map((i) => i.value));

  if (items.length === 0) {
    return <p className="py-4 text-sm text-text-subtle">{emptyLabel}</p>;
  }

  return (
    <ul className="space-y-2.5">
      {items.map((item) => {
        const row = (
          <>
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="truncate text-text-muted group-hover:text-text">
                {item.label}
              </span>
              <span className="font-medium tabular text-text">
                {item.value.toLocaleString("en-IN")}
              </span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[var(--viz-track)]">
              <div
                className="grow-x h-full rounded-full bg-[var(--viz-2)]"
                style={{ width: `${(item.value / max) * 100}%` }}
              />
            </div>
          </>
        );

        return (
          <li key={item.key}>
            {/* A bar the reader wants to interrogate should take them to the
                rows behind it, not just sit there being a length. */}
            {item.href ? (
              <Link
                href={item.href}
                className="group -mx-2 block rounded-lg px-2 py-1 transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-subtle)]"
              >
                {row}
              </Link>
            ) : (
              row
            )}
          </li>
        );
      })}
    </ul>
  );
}

/* ============================================================ progress ring */

/* ================================================================= pipeline */

/**
 * An ordered process, drawn.
 *
 * Not a chart — a diagram of a state machine. The current step is marked with
 * text as well as colour (`aria-current` plus a visually-hidden "current
 * step"), so the position survives greyscale and screen readers alike.
 */
export function Pipeline({
  steps,
  currentIndex,
  terminal,
}: {
  steps: Array<{ key: string; label: string }>;
  currentIndex: number;
  /** Set when the machine has left the happy path (e.g. closed). */
  terminal?: { label: string; note?: string };
}) {
  if (terminal) {
    return (
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-bg-subtle px-3 py-2">
        <span className="rounded-full bg-bg-inset px-2.5 py-1 text-xs font-medium text-text-muted">
          {terminal.label}
        </span>
        {terminal.note && <span className="text-xs text-text-subtle">{terminal.note}</span>}
      </div>
    );
  }

  return (
    <ol className="flex flex-wrap items-center gap-1.5" aria-label="Progress">
      {steps.map((step, index) => {
        const done = index < currentIndex;
        const current = index === currentIndex;

        return (
          <li key={step.key} className="flex items-center gap-1.5">
            <span
              aria-current={current ? "step" : undefined}
              className={cn(
                "relative rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                current && "brand-gradient border-transparent text-white shadow-[var(--shadow-sm)]",
                done && "border-success-border bg-success-subtle text-success-text",
                !current && !done && "border-border bg-bg-inset text-text-subtle",
              )}
            >
              {step.label}
              {current && <span className="sr-only"> (current step)</span>}
              {done && <span className="sr-only"> (completed)</span>}
            </span>

            {index < steps.length - 1 && (
              <span
                aria-hidden="true"
                className={cn(
                  "h-px w-4 rounded-full",
                  done ? "bg-success-border" : "bg-border",
                )}
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}
