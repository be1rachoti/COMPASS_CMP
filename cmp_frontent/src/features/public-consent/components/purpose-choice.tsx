/**
 * One purpose, and the choice about it.
 *
 * The most carefully specified control in the system, because it is where the
 * statute meets the interface:
 *
 * - **Nothing is pre-ticked.** s.6(1) requires an affirmative action, and a
 *   box that arrives ticked is not one.
 * - **Yes and No are the same size, the same weight and the same distance from
 *   the thumb.** Making refusal harder to reach than agreement is the dark
 *   pattern the Act is aimed at, and a design that nudges is a design that
 *   produces consent nobody can defend.
 * - **The retention period and the categories are on the control**, not behind
 *   a link. Rule 3(b) requires them to be given, and giving them somewhere the
 *   person has to go looking is not giving them.
 */
"use client";

import { Check, X } from "lucide-react";

import { formatDuration, humanise } from "@/lib/format";
import type { Purpose } from "@/types";

export function PurposeChoice({
  purpose,
  value,
  onChange,
}: {
  purpose: Purpose;
  value: boolean | undefined;
  onChange: (value: boolean) => void;
}) {
  const name = `purpose-${purpose.purpose_uuid}`;

  return (
    <fieldset className="rounded-md border border-border p-4">
      <legend className="px-1 text-sm font-medium">{purpose.name}</legend>

      <p className="text-sm text-text-muted">{purpose.description}</p>
      <p className="mt-2 text-xs text-text-muted">
        <span className="font-medium text-text">What this allows: </span>
        {purpose.uses}
      </p>

      <dl className="mt-3 grid gap-1 text-xs text-text-subtle sm:grid-cols-2">
        <div>
          <dt className="inline font-medium">Data collected: </dt>
          <dd className="inline">
            {purpose.data_categories.map((c) => humanise(c)).join(", ")}
          </dd>
        </div>
        <div>
          <dt className="inline font-medium">Kept for: </dt>
          <dd className="inline">{formatDuration(purpose.retention_period)}</dd>
        </div>
      </dl>

      <div className="mt-3 flex gap-2" role="radiogroup" aria-label={`Your choice for ${purpose.name}`}>
        <label
          className={[
            "flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm",
            value === true
              ? "border-success-border bg-success-subtle text-success-text font-medium"
              : "border-border hover:bg-surface-hover",
          ].join(" ")}
        >
          <input
            type="radio"
            name={name}
            className="sr-only"
            checked={value === true}
            onChange={() => onChange(true)}
          />
          <Check className="size-4" aria-hidden="true" />I agree
        </label>

        <label
          className={[
            "flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm",
            value === false
              ? "border-border-strong bg-bg-inset text-text font-medium"
              : "border-border hover:bg-surface-hover",
            purpose.is_mandatory ? "cursor-not-allowed opacity-50" : "",
          ].join(" ")}
        >
          <input
            type="radio"
            name={name}
            className="sr-only"
            checked={value === false}
            disabled={purpose.is_mandatory}
            onChange={() => onChange(false)}
          />
          <X className="size-4" aria-hidden="true" />
          {purpose.is_mandatory ? "Cannot be refused" : "I do not agree"}
        </label>
      </div>
    </fieldset>
  );
}
