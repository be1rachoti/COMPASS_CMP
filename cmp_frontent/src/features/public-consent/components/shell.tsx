/**
 * The frame every step renders inside.
 *
 * Kept separate from the steps so the branding, the language of the heading and
 * the footer are decided once. A consent screen that changes shape between
 * steps reads as three different websites.
 */
"use client";

import * as React from "react";

import { BrandMark, SignalField } from "@/components/ui/graphics";

export function Shell({
  children,
  projectName,
  siteLabel,
}: {
  children: React.ReactNode;
  projectName?: string;
  siteLabel?: string;
}) {
  return (
    <div className="min-h-dvh bg-bg-subtle">
      {/* The banner is the only branded surface in the flow. Everything below it
          is plain, high-contrast reading material: this is a legal notice, and
          it should not look like a marketing page. */}
      <header className="brand-gradient relative overflow-hidden">
        <SignalField className="absolute -right-16 -top-24 h-64 w-64 text-white/40" />
        <div className="relative mx-auto flex max-w-2xl items-center gap-3 px-4 py-5">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-white/15 ring-1 ring-white/25">
            <BrandMark className="size-6 text-white" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-white">
              {projectName ?? "Consent"}
            </p>
            <p className="truncate text-xs text-white/75">
              {siteLabel ?? "Digital Personal Data Protection Act 2023"}
            </p>
          </div>
        </div>
      </header>

      <main id="main" className="mx-auto max-w-2xl px-4 py-8 sm:py-10">
        {children}

        <p className="mt-8 text-center text-xs text-text-subtle">
          <a href="/rights" className="underline underline-offset-2 hover:text-text-muted">
            Your rights under the DPDP Act
          </a>
        </p>
      </main>
    </div>
  );
}
