/**
 * The frame around every unauthenticated screen: sign-in, MFA, and the public
 * consent flow.
 *
 * A split panel. The left side carries the brand and says what this system is
 * for; the right side carries the one job the visitor came to do. Below `lg`
 * the left panel collapses to a compact header rather than stacking — a data
 * subject opening a consent link on a phone at a collection site should see the
 * form without scrolling past decoration.
 */
"use client";

import * as React from "react";

import { BrandMark, SignalField } from "@/components/ui/graphics";
import { config } from "@/lib/config";

export function AuthLayout({
  title,
  subtitle,
  children,
  footer,
  /** Three short lines shown on the brand panel. Reassurance, not marketing:
   *  each one is a fact about how the record is handled. */
  assurances = [
    "Every consent is recorded with its notice version",
    "Withdrawal is as easy as giving consent",
    "The audit trail is append-only and hash-chained",
  ],
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  assurances?: string[];
}) {
  return (
    <main id="main" className="min-h-dvh lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,520px)]">
      {/* ------------------------------------------------- the brand panel */}
      <section className="brand-gradient relative hidden overflow-hidden lg:flex lg:flex-col lg:justify-between lg:p-12">
        <SignalField className="absolute -right-24 top-1/2 h-[130%] w-auto -translate-y-1/2 text-white/40" />

        <div className="relative flex items-center gap-3 text-white">
          <span className="grid size-10 place-items-center rounded-xl bg-white/15 ring-1 ring-white/25 backdrop-blur">
            <BrandMark className="size-6 text-white" />
          </span>
          <span className="text-lg font-semibold tracking-tight">{config.appName}</span>
        </div>

        <div className="relative max-w-lg text-white">
          {/* `text-white` is repeated on the heading deliberately: the base
              layer sets a colour on h1-h4, and that beats inheritance from the
              wrapper. */}
          <h2 className="text-balance text-3xl font-semibold leading-tight tracking-tight text-white">
            Consent that can be proved, not just claimed.
          </h2>
          <p className="mt-4 text-sm leading-relaxed text-white/80">
            A consent management platform built to the Digital Personal Data
            Protection Act 2023 — purpose-bound, notice-linked, and withdrawable
            at any time.
          </p>

          <ul className="stagger mt-8 space-y-3">
            {assurances.map((line) => (
              <li key={line} className="flex items-start gap-3 text-sm text-white/85">
                <span
                  aria-hidden="true"
                  className="mt-1 grid size-4 shrink-0 place-items-center rounded-full bg-white/20"
                >
                  <svg viewBox="0 0 12 12" className="size-2.5" fill="none" aria-hidden="true">
                    <path
                      d="m2.5 6.2 2.2 2.2L9.5 3.6"
                      stroke="white"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </span>
                {line}
              </li>
            ))}
          </ul>
        </div>

        <p className="relative text-xs text-white/60">
          Operated by the Privacy Office. Records are retained under the
          project&rsquo;s stated retention policy.
        </p>
      </section>

      {/* -------------------------------------------------- the form panel */}
      <section className="relative flex min-h-dvh flex-col justify-center bg-bg px-4 py-10 sm:px-8 lg:min-h-0 lg:px-12">
        <div aria-hidden="true" className="aurora pointer-events-none absolute inset-0 lg:hidden" />

        <div className="animate-in relative mx-auto w-full max-w-md">
          {/* The compact brand lockup, for the collapsed layout only. */}
          <div className="mb-8 flex items-center gap-2.5 lg:hidden">
            <span className="brand-gradient grid size-9 place-items-center rounded-xl shadow-[var(--shadow-sm)]">
              <BrandMark className="size-5 text-white" />
            </span>
            <span className="font-semibold tracking-tight">{config.appName}</span>
          </div>

          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {subtitle && <p className="mt-2 text-sm leading-relaxed text-text-muted">{subtitle}</p>}

          <div className="mt-7">{children}</div>

          {footer && <div className="mt-8">{footer}</div>}
        </div>
      </section>
    </main>
  );
}
