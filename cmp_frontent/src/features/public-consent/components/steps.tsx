/**
 * The step indicator.
 *
 * Shown because the flow has four steps, and somebody halfway through a consent
 * form on a phone at a collection site needs to know how much is left. A person
 * who cannot see how far they have to go is a person who abandons the form —
 * and an abandoned consent form is a collection that did not happen.
 */
"use client";

import { Pipeline } from "@/components/ui/charts";

export type Step = "loading" | "invalid" | "register" | "verify" | "notice" | "done";

/**
 * Only the four steps a person walks. `loading` and `invalid` are states the
 * flow can be in, not places it goes, and showing them as stops on a journey
 * would be a lie about the journey.
 */
export const STEP_LABELS: Array<{ key: Step; label: string }> = [
  { key: "register", label: "Your details" },
  { key: "verify", label: "Confirm" },
  { key: "notice", label: "The notice" },
  { key: "done", label: "Done" },
];

export function Steps({ current }: { current: Step }) {
  const index = STEP_LABELS.findIndex((s) => s.key === current);
  return (
    <div className="mb-5">
      <Pipeline steps={STEP_LABELS} currentIndex={index} />
    </div>
  );
}
