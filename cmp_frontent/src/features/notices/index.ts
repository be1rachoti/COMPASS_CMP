/**
 * Notices, their purposes, their languages and publication.
 *
 * Pages import from here, never from the modules directly, so that moving a
 * hook between `queries` and `mutations` is not a tree-wide rewrite.
 */

export * from "@/features/notices/queries";
export * from "@/features/notices/mutations";
