/**
 * Inline SVG graphics.
 *
 * Inline rather than image files for three reasons that matter here: they
 * inherit `currentColor` so they follow the theme without a second dark-mode
 * asset, they carry no network request on a page a data subject may be opening
 * on a phone at a collection site, and they scale without a 2x variant.
 *
 * Every one is decorative, so every one is `aria-hidden`. The meaning is always
 * carried by adjacent text — an illustration that has to be described is an
 * illustration doing a job that a sentence should be doing.
 */
"use client";

import * as React from "react";

/**
 * The product mark: a shield holding a check.
 *
 * A shield because this is a protection tool, and a check because the thing it
 * protects is a *record of agreement*. Drawn on a 24-grid with a 2px stroke so
 * it sits on the pixel grid at 24, 32 and 48.
 */
export function BrandMark({
  className,
  gradient = false,
}: {
  className?: string;
  gradient?: boolean;
}) {
  const id = React.useId();
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      {gradient && (
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="24" y2="24" gradientUnits="userSpaceOnUse">
            <stop stopColor="var(--grad-from)" />
            <stop offset="1" stopColor="var(--grad-to)" />
          </linearGradient>
        </defs>
      )}
      <path
        d="M12 2.5 4.5 5.6v6.1c0 4.6 3.1 8.9 7.5 10.2 4.4-1.3 7.5-5.6 7.5-10.2V5.6L12 2.5Z"
        fill={gradient ? `url(#${id})` : "currentColor"}
        fillOpacity={gradient ? 1 : 0.12}
        stroke={gradient ? "none" : "currentColor"}
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path
        d="m8.6 12.1 2.4 2.4 4.4-4.7"
        stroke={gradient ? "white" : "currentColor"}
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * Decorative background for the sign-in and consent screens.
 *
 * Concentric arcs radiating from a point: a signal spreading outward, which is
 * what a notice is. Kept to two low-opacity hues so it never competes with the
 * form sitting on top of it.
 */
export function SignalField({ className }: { className?: string }) {
  const id = React.useId();
  return (
    <svg
      viewBox="0 0 400 400"
      fill="none"
      className={className}
      aria-hidden="true"
      preserveAspectRatio="xMidYMid slice"
    >
      <defs>
        <radialGradient id={`${id}-fade`} cx="0.5" cy="0.5" r="0.5">
          <stop stopColor="white" stopOpacity="0.9" />
          <stop offset="1" stopColor="white" stopOpacity="0" />
        </radialGradient>
        <mask id={`${id}-mask`}>
          <rect width="400" height="400" fill={`url(#${id}-fade)`} />
        </mask>
      </defs>

      <g mask={`url(#${id}-mask)`} stroke="currentColor" fill="none">
        {[40, 78, 116, 154, 192].map((r, i) => (
          <circle
            key={r}
            cx="200"
            cy="200"
            r={r}
            strokeWidth={i === 0 ? 1.5 : 1}
            strokeOpacity={0.38 - i * 0.055}
          />
        ))}
        {/* Radials, drawn only in the lower half so the composition has a
            direction rather than reading as a target. */}
        {[0, 30, 60, 90, 120, 150].map((deg) => (
          <line
            key={deg}
            x1="200"
            y1="200"
            x2={200 + 200 * Math.cos(((deg + 15) * Math.PI) / 180)}
            y2={200 + 200 * Math.sin(((deg + 15) * Math.PI) / 180)}
            strokeWidth="1"
            strokeOpacity="0.12"
          />
        ))}
      </g>

      <circle cx="200" cy="200" r="5" fill="currentColor" fillOpacity="0.5" />
    </svg>
  );
}

/* ==========================================================================
   Empty-state illustrations.

   All drawn on the same 120x88 grid with the same 1.5px stroke, so a product
   with a dozen empty states looks like one product rather than a stock-art
   collage. Each is a *diagram of the missing thing*, not a mascot: the point is
   to say "there is nothing here yet", not to be charming about it.
   ========================================================================== */

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 120 88"
      fill="none"
      className="h-20 w-auto"
      aria-hidden="true"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

/** Sheets of paper — used wherever a list of records is empty. */
export function EmptyRecords() {
  return (
    <Frame>
      <rect
        x="26" y="14" width="58" height="66" rx="6"
        className="fill-[var(--bg-inset)] stroke-[var(--border-strong)]"
        strokeWidth="1.5"
      />
      <rect
        x="36" y="8" width="58" height="66" rx="6"
        className="fill-[var(--surface)] stroke-[var(--border-strong)]"
        strokeWidth="1.5"
      />
      {[22, 32, 42, 52].map((y, i) => (
        <line
          key={y}
          x1="46" y1={y} x2={i === 3 ? 70 : 84} y2={y}
          className="stroke-[var(--border)]"
          strokeWidth="3"
        />
      ))}
      <circle cx="46" cy="62" r="4" className="stroke-[var(--accent-border)]" strokeWidth="1.5" />
    </Frame>
  );
}

/** A shield with a gap — used for consent and audit surfaces with no data. */
export function EmptyConsent() {
  return (
    <Frame>
      <path
        d="M60 10 34 20v22c0 16 11 30 26 36 15-6 26-20 26-36V20L60 10Z"
        className="fill-[var(--accent-subtle)] stroke-[var(--accent-border)]"
        strokeWidth="1.5"
      />
      <path
        d="m50 44 7 7 14-15"
        className="stroke-[var(--accent-border)]"
        strokeWidth="2.5"
        strokeDasharray="3 4"
      />
    </Frame>
  );
}

/** An open tray — used for queues and inboxes that are clear. */
export function EmptyQueue() {
  return (
    <Frame>
      <path
        d="M24 46h20l6 10h20l6-10h20v22a6 6 0 0 1-6 6H30a6 6 0 0 1-6-6V46Z"
        className="fill-[var(--bg-inset)] stroke-[var(--border-strong)]"
        strokeWidth="1.5"
      />
      <path
        d="M32 46 40 20a4 4 0 0 1 4-3h32a4 4 0 0 1 4 3l8 26"
        className="stroke-[var(--border-strong)]"
        strokeWidth="1.5"
      />
      <circle cx="60" cy="30" r="3" className="fill-[var(--success)]" />
    </Frame>
  );
}

/** A link, broken — used for consent-link surfaces with nothing active. */
export function EmptyLink() {
  return (
    <Frame>
      <path
        d="M46 44 36 54a11 11 0 0 0 16 16l6-6"
        className="stroke-[var(--border-strong)]"
        strokeWidth="3"
      />
      <path
        d="m74 44 10-10a11 11 0 0 0-16-16l-6 6"
        className="stroke-[var(--border-strong)]"
        strokeWidth="3"
      />
      <line
        x1="52" y1="42" x2="68" y2="26"
        className="stroke-[var(--accent-border)]"
        strokeWidth="3"
        strokeDasharray="4 5"
      />
    </Frame>
  );
}

/** A pipeline with an empty first stage — used for projects. */
export function EmptyProjects() {
  return (
    <Frame>
      {[
        { x: 16, filled: true },
        { x: 46, filled: false },
        { x: 76, filled: false },
      ].map((step, i) => (
        <g key={step.x}>
          <rect
            x={step.x} y="30" width="28" height="28" rx="7"
            className={
              step.filled
                ? "fill-[var(--accent-subtle)] stroke-[var(--accent-border)]"
                : "fill-[var(--bg-inset)] stroke-[var(--border-strong)]"
            }
            strokeWidth="1.5"
            strokeDasharray={step.filled ? undefined : "3 4"}
          />
          {i < 2 && (
            <line
              x1={step.x + 30} y1="44" x2={step.x + 44} y2="44"
              className="stroke-[var(--border-strong)]"
              strokeWidth="1.5"
              strokeDasharray="3 4"
            />
          )}
        </g>
      ))}
    </Frame>
  );
}

