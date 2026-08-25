/**
 * The four steps of the public consent flow, plus the frame they render in.
 *
 * Each step owns its own submission and its own error state, and reports
 * upward through callbacks. The page holds only which step is current — the
 * state machine — and none of the form state, which is why it stays readable
 * at a glance.
 */

export { Shell } from "@/features/public-consent/components/shell";
export { Steps, STEP_LABELS, type Step } from "@/features/public-consent/components/steps";
export { RegisterStep } from "@/features/public-consent/components/register-step";
export { VerifyStep } from "@/features/public-consent/components/verify-step";
export { NoticeStep } from "@/features/public-consent/components/notice-step";
export { DoneStep } from "@/features/public-consent/components/done-step";
export { PurposeChoice } from "@/features/public-consent/components/purpose-choice";
export { LANGUAGE_NAMES } from "@/features/public-consent/components/languages";
