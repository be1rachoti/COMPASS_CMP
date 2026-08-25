/**
 * Projects, sites, approvals and the lifecycle state machine.
 *
 * Pages import from here, never from the modules directly, so that moving a
 * function between `api`, `queries` and `mutations` is not a tree-wide rewrite.
 *
 * The layering inside is one-way and worth knowing when reading a page:
 *
 *     component -> queries/mutations -> api -> lib/api client -> /api
 */

export * from "@/features/projects/api";
export * from "@/features/projects/queries";
export * from "@/features/projects/mutations";
export * from "@/features/projects/schemas";
