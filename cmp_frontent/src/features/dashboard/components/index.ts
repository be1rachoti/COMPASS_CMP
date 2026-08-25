/**
 * The dashboard's parts.
 *
 * The page was 490 lines: four lookup tables, two derivations, three cards and
 * the composition of all of them. What was hard to see in that file is the
 * thing the page actually does — decide which figures a chart has already
 * explained, and show the rest as tiles.
 */

export {
  COUNT_LABELS,
  COUNT_LINKS,
  SUBJECT_LINKS,
  WARNING_COUNTS,
  LIFECYCLE,
} from "@/features/dashboard/components/config";
export { COUNT_ICONS } from "@/features/dashboard/components/icons";
export { consentComposition, roleBlurb } from "@/features/dashboard/components/helpers";
export { QueueCard } from "@/features/dashboard/components/queue-card";
export { RecentCard } from "@/features/dashboard/components/recent-card";
export { DashboardSkeleton } from "@/features/dashboard/components/skeleton";
