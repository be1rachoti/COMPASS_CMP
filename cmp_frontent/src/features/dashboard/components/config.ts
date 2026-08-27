/**
 * What each dashboard figure is called, where it links, and how it reads.
 *
 * Data rather than code, and in its own file, because these four tables are
 * the whole vocabulary of the screen — a count the API adds appears as a tile
 * the moment it is named here, and one that is not named still appears, with a
 * humanised key. Nothing breaks; it just reads less well until somebody writes
 * the label.
 */



/** Counts worth surfacing, and what they mean. Anything not listed is rendered
 *  with a humanised key - a new backend count appears rather than disappearing. */
export const COUNT_LABELS: Record<string, string> = {
  in_draft: "In draft",
  pending_approval: "Pending approval",
  approved: "Approved",
  closed: "Closed",
  total: "Total projects",
  draft_notices: "Draft notices",
  draft_purposes: "Draft purposes",
  total_consents: "Consent records",
  withdrawals: "Withdrawals",
  unapproved_languages: "Unapproved translations",
  access_denials_7d: "Access denials (7d)",
  approved_projects: "Approved projects",
  pending_processors: "Collectors awaiting your decision",
  projects: "Third-party projects",
  sites_awaiting_source: "Sites awaiting a data source",
  sources_without_owner: "Sources with nobody accountable",
  active_links: "Active links",
  consents: "Consents",
  exports: "Exports",
  flagged_assets: "Assets with unmapped subjects",
  times_shared: "Times shared",
  active: "Active consents",
  withdrawn: "Withdrawn",
  declined: "Declined",
};

/**
 * Where the rows behind each figure live.
 *
 * A dashboard number that cannot be clicked is a dead end: the reader's next
 * question is always "which ones", and making them find the list by hand is the
 * difference between a dashboard and a poster.
 *
 * Keys that mean different things to different roles resolve at render time —
 * "consents" is the staff register for staff and her own record for a data
 * subject.
 */
export const COUNT_LINKS: Record<string, string> = {
  total: "/projects",
  in_draft: "/projects?status=in_draft",
  pending_approval: "/projects?status=pending_approval",
  approved: "/projects?status=approved",
  closed: "/projects?status=closed",
  approved_projects: "/projects?status=approved",
  projects: "/projects",
  sites_awaiting_source: "/sites",
  // Straight to the queue rather than the whole registry: the count is the
  // number of rows behind this filter, so the link should land on them.
  sources_without_owner: "/sources?unowned=1",

  draft_notices: "/notices?status=draft",
  unapproved_languages: "/notices",
  draft_purposes: "/purposes?status=draft",

  total_consents: "/consents",
  withdrawals: "/consents?status=withdrawn",
  active_links: "/links?status=active",

  exports: "/exports",
  flagged_assets: "/collections",
  access_denials_7d: "/audit",
};

/** The data subject's own figures point at her own records, not the register. */
export const SUBJECT_LINKS: Record<string, string> = {
  active: "/my-consents",
  withdrawn: "/my-consents",
  declined: "/my-consents",
  consents: "/my-consents",
  times_shared: "/my-consents",
};

/** Counts that are a problem when non-zero, rather than a neutral statistic. */
export const WARNING_COUNTS = new Set([
  "flagged_assets",
  "unapproved_languages",
  "access_denials_7d",
]);

/** The project state machine, in the order it is walked.
 *
 *  Four steps, not five. `under_process` sat between the first two and belonged
 *  to the DPO, which put a second person's step in the middle of one person's
 *  work; assembly is one state now. The value still exists for history rows and
 *  is deliberately absent here — a progress bar with a step nothing can reach
 *  shows every project as permanently stalled at it. */
export const LIFECYCLE = ["in_draft", "pending_approval", "approved", "closed"] as const;
