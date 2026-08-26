/**
 * Which filters are on, and how to take them off.
 *
 * Replaces a bare "Clear" button that appeared when something was filtered and
 * said nothing about *what*. Two problems with that, and the second is the
 * worse one:
 *
 * * It is a button whose effect you cannot predict. "Clear" clears — what?
 * * A filtered list that looks like an unfiltered one is how somebody concludes
 *   a project is missing. The status dropdown is the only evidence, it is
 *   easily missed, and a search term has no visible home at all once the box
 *   scrolls away.
 *
 * So each active filter is a chip that names itself and removes only itself,
 * and "Clear all" appears once there is more than one — because a single chip
 * already has its own remove control and a second button beside it is noise.
 *
 * Rendering nothing when no filter is on is deliberate: an empty bar reserving
 * space for chips that are not there makes every unfiltered page slightly
 * wrong, and is the sort of thing that gets solved with a fixed height and a
 * comment apologising for it.
 */
"use client";

import { X } from "lucide-react";

import { Button } from "@/components/ui/primitives";

export interface ActiveFilter {
  /** What the filter is on. Shown small and uppercase — it is the label, not
   *  the value, and the value is what the eye should land on. */
  label: string;
  value: string;
  /** Remove this one. */
  onClear: () => void;
}

export function ActiveFilters({
  filters,
  onClearAll,
}: {
  filters: ActiveFilter[];
  onClearAll: () => void;
}) {
  const active = filters.filter((f) => f.value);
  if (active.length === 0) return null;

  return (
    <div
      className="mb-4 flex flex-wrap items-center gap-2"
      // Announced, because the list below has just changed underneath somebody
      // who may not have seen why.
      role="status"
      aria-live="polite"
    >
      <span className="text-xs font-medium uppercase tracking-wide text-text-subtle">
        Filtered by
      </span>

      {active.map((filter) => (
        <span
          key={filter.label}
          className="inline-flex items-center gap-1.5 rounded-full border border-accent-border bg-accent-subtle py-1 pl-2.5 pr-1 text-xs"
        >
          <span className="text-text-muted">{filter.label}</span>
          <span className="font-medium text-accent-text">{filter.value}</span>
          <button
            type="button"
            onClick={filter.onClear}
            // Named for what it removes, not "remove filter". A screen-reader
            // user hearing five identical labels cannot tell them apart.
            aria-label={`Remove the ${filter.label.toLowerCase()} filter, ${filter.value}`}
            className="grid size-5 place-items-center rounded-full text-accent-text/70 transition-colors hover:bg-accent/15 hover:text-accent-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-subtle)]"
          >
            <X className="size-3" aria-hidden="true" />
          </button>
        </span>
      ))}

      {active.length > 1 && (
        <Button variant="ghost" size="sm" onClick={onClearAll} className="text-text-subtle">
          Clear all
        </Button>
      )}
    </div>
  );
}
