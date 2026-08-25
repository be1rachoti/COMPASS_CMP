/**
 * The data principal's own consents and disclosures.
 *
 * Pages import from here, never from the modules directly, so that moving a
 * hook between `queries` and `mutations` is not a tree-wide rewrite.
 */

export * from "@/features/my-consents/api";
export * from "@/features/my-consents/queries";
export * from "@/features/my-consents/mutations";
