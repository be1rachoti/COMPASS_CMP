/**
 * The public consent flow.
 *
 * No hooks here on purpose. The flow is a four-step wizard with its own state
 * machine — which step, which language, which notice was served — and wrapping
 * those calls in TanStack Query would put that state in a cache keyed by
 * something, when it belongs to one mounted component and dies with it.
 */

export * from "@/features/public-consent/api";
export * from "@/features/public-consent/components";
