/**
 * The API's vocabulary, as TypeScript.
 *
 * One module per domain, mirroring the backend's own package split, so that a
 * change to the consent contract touches `consent.ts` and nothing else. The
 * barrel exists so call sites import from `@/types` and stay indifferent to
 * which module a name lives in — moving a type between modules is then not a
 * tree-wide rewrite.
 *
 * Import order below is dependency order: primitives depend on nothing, enums on
 * nothing, and everything else on those two.
 */

export * from "@/types/primitives";
export * from "@/types/enums";
export * from "@/types/envelope";
export * from "@/types/identity";
export * from "@/types/registry";
export * from "@/types/projects";
export * from "@/types/notices";
export * from "@/types/consent";
export * from "@/types/exchange";
export * from "@/types/audit";
export * from "@/types/dashboard";
export * from "@/types/meta";
export * from "@/types/public";
