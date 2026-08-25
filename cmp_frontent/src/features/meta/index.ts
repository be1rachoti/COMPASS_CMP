/**
 * Reference data: enum labels and the data-category taxonomy.
 *
 * Pages import from here, never from the modules directly, so that moving a
 * hook between `queries` and `mutations` is not a tree-wide rewrite.
 */

export * from "@/features/meta/api";
export * from "@/features/meta/queries";
