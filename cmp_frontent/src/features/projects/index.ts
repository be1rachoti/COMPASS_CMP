/**
 * Projects, sites, approvals and the lifecycle state machine.
 *
 * Pages import from here, never from the modules directly, so that moving a
 * hook between `queries` and `mutations` is not a tree-wide rewrite.
 */

export * from "@/features/projects/queries";
export * from "@/features/projects/mutations";
