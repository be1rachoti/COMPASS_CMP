/**
 * Consent links, artefacts, grants and the evidence behind them.
 *
 * Pages import from here, never from the modules directly, so that moving a
 * hook between `queries` and `mutations` is not a tree-wide rewrite.
 */

export * from "@/features/consent/api";
export * from "@/features/consent/queries";
export * from "@/features/consent/mutations";
