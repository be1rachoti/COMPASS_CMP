/**
 * The two derivations the dashboard makes from its own payload.
 *
 * Pulled out because both are decisions rather than rendering: which counts a
 * chart has already explained (so they are not repeated as tiles), and what to
 * tell somebody about their own role. Both are testable here and were not
 * inside a 490-line component.
 */

import { Segment } from "@/components/ui/charts";

/**
 * Build the part-to-whole view of consent, from whichever counts this role got.
 *
 * Returns the keys it consumed so the caller can avoid printing the same number
 * twice. Returns null when the response does not carry enough to make an honest
 * whole — a composition chart missing a slice is worse than no chart.
 */
export function consentComposition(
  counts: Record<string, number>,
): { segments: Segment[]; consumed: string[] } | null {
  // The data subject's own record: explicit states, nothing to derive.
  if ("active" in counts && ("withdrawn" in counts || "declined" in counts)) {
    return {
      segments: [
        { key: "active", label: "Active", value: counts.active ?? 0, color: "var(--viz-1)" },
        { key: "withdrawn", label: "Withdrawn", value: counts.withdrawn ?? 0, color: "var(--viz-3)" },
        // Declined is grey rather than red: it is a valid answer, not a fault.
        { key: "declined", label: "Declined", value: counts.declined ?? 0, color: "var(--viz-neutral)" },
      ],
      consumed: ["active", "withdrawn", "declined"],
    };
  }

  // Staff view: the register reports a total and the withdrawals within it.
  if ("total_consents" in counts && "withdrawals" in counts) {
    const withdrawn = counts.withdrawals ?? 0;
    const standing = Math.max(0, (counts.total_consents ?? 0) - withdrawn);
    return {
      segments: [
        { key: "standing", label: "Still standing", value: standing, color: "var(--viz-1)" },
        { key: "withdrawn", label: "Withdrawn", value: withdrawn, color: "var(--viz-3)" },
      ],
      consumed: ["total_consents", "withdrawals"],
    };
  }

  return null;
}

export function roleBlurb(role: string | null | undefined): string {
  switch (role) {
    case "dpo":
      return "Notices awaiting publication, projects awaiting your review, and the consent position across the platform.";
    case "dco":
      return "Your approved projects, the links collecting against them, and anything that failed to reconcile on import.";
    case "rnd_user":
      return "Your projects and what each one needs from you before it can move forward.";
    case "admin":
      return "Accounts, lockouts, and the state of the processor and source registry.";
    default:
      return "Your consents and what has happened to your data.";
  }
}
