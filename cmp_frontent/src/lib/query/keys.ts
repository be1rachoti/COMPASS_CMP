/**
 * Every query key in the console, in one place.
 *
 * This file exists so invalidation can be *reasoned about* rather than
 * remembered. When a mutation succeeds it has to invalidate every cached view
 * the write affected, and the failure mode is not a crash — it is a screen that
 * quietly shows the old number. The usual "fix" is a page reload, which hides
 * the bug rather than removing it.
 *
 * Two properties make that reliable:
 *
 * **Keys are grouped by domain, and the group prefix is shared.** Every project
 * key starts `["project", uuid, ...]`, so `invalidateQueries({ queryKey:
 * keys.project.detail(uuid) })` reaches the detail, its summary, its history,
 * its transitions, its approvals and its sites in one call — TanStack matches
 * on key prefix. Getting the prefixes right is what makes that work; a key of
 * `["project-summary", uuid]` would look similar and invalidate nothing.
 *
 * **Filters are part of the key, always last.** `["projects", {status: "open"}]`
 * and `["projects", {}]` are different cached lists, which is correct — they
 * hold different rows. Invalidating `["projects"]` reaches both.
 *
 * `as const` throughout so the tuples stay literal types and a typo in a key
 * segment is a compile error rather than a cache miss nobody notices.
 */

import type { Uuid } from "@/types";

type Params = Record<string, unknown> | undefined;

export const keys = {
  auth: {
    me: ["auth", "me"] as const,
  },

  meta: {
    enums: ["meta", "enums"] as const,
    dataCategories: ["meta", "data-categories"] as const,
  },

  dashboard: {
    all: ["dashboard"] as const,
  },

  notifications: {
    all: ["notifications"] as const,
  },

  /**
   * Projects and everything hanging off one.
   *
   * The nested keys all share the `["project", uuid]` prefix deliberately: a
   * lifecycle transition changes the project, its available transitions, its
   * history and often its approvals, and one invalidation should cover all of
   * them. `list` and the two `all*` lists sit outside that prefix because they
   * are cross-project and are invalidated separately.
   */
  project: {
    list: (params?: Params) => ["projects", params ?? {}] as const,
    detail: (uuid: Uuid) => ["project", uuid] as const,
    summary: (uuid: Uuid) => ["project", uuid, "summary"] as const,
    history: (uuid: Uuid) => ["project", uuid, "history"] as const,
    transitions: (uuid: Uuid) => ["project", uuid, "transitions"] as const,
    approvals: (uuid: Uuid) => ["project", uuid, "approvals"] as const,
    sites: (uuid: Uuid) => ["project", uuid, "sites"] as const,
    processors: (uuid: Uuid) => ["project", uuid, "processors"] as const,
    allSites: (params?: Params) => ["all", "sites", params ?? {}] as const,
    allApprovals: (params?: Params) => ["all", "approvals", params ?? {}] as const,
  },

  notice: {
    /** Notices belonging to one project. */
    list: (projectUuid: Uuid) => ["project", projectUuid, "notices"] as const,
    /** Every notice the caller may see, across projects. */
    all: (params?: Params) => ["all", "notices", params ?? {}] as const,
    detail: (uuid: Uuid) => ["notice", uuid] as const,
    checklist: (uuid: Uuid) => ["notice", uuid, "checklist"] as const,
    purposes: (uuid: Uuid) => ["notice", uuid, "purposes"] as const,
    languages: (uuid: Uuid) => ["notice", uuid, "languages"] as const,
  },

  registry: {
    purposes: (params?: Params) => ["purposes", params ?? {}] as const,
    purpose: (uuid: Uuid) => ["purpose", uuid] as const,
    purposeUsage: (uuid: Uuid) => ["purpose", uuid, "usage"] as const,
    purposeVersions: (uuid: Uuid) => ["purpose", uuid, "versions"] as const,
    processors: (params?: Params) => ["processors", params ?? {}] as const,
    sources: (params?: Params) => ["sources", params ?? {}] as const,
  },

  consent: {
    list: (projectUuid: Uuid, params?: Params) =>
      ["project", projectUuid, "consents", params ?? {}] as const,
    all: (params?: Params) => ["all", "consents", params ?? {}] as const,
    summary: (projectUuid: Uuid) => ["project", projectUuid, "consents", "summary"] as const,
    detail: (uuid: Uuid) => ["consent", uuid] as const,
    grants: (uuid: Uuid) => ["consent", uuid, "grants"] as const,
    assets: (uuid: Uuid) => ["consent", uuid, "assets"] as const,
    links: (projectUuid: Uuid) => ["project", projectUuid, "links"] as const,
    allLinks: (params?: Params) => ["all", "links", params ?? {}] as const,
    linkStats: (uuid: Uuid) => ["link", uuid, "stats"] as const,
  },

  exchange: {
    exports: (projectUuid: Uuid) => ["project", projectUuid, "exports"] as const,
    allExports: (params?: Params) => ["all", "exports", params ?? {}] as const,
    imports: (params?: Params) => ["imports", params ?? {}] as const,
    importBatch: (uuid: Uuid) => ["import", uuid] as const,
    importErrors: (uuid: Uuid) => ["import", uuid, "errors"] as const,
    collections: (projectUuid: Uuid) => ["project", projectUuid, "collections"] as const,
    allCollections: (params?: Params) => ["all", "collections", params ?? {}] as const,
    collection: (uuid: Uuid) => ["collection", uuid] as const,
    collectionAssets: (uuid: Uuid) => ["collection", uuid, "assets"] as const,
    collectionExceptions: (uuid: Uuid) => ["collection", uuid, "exceptions"] as const,
  },

  audit: {
    list: (params?: Params) => ["audit", params ?? {}] as const,
    verify: ["audit", "verify"] as const,
  },

  /**
   * Cover arrangements.
   *
   * Three separate keys rather than one filtered list: "cover I arranged",
   * "cover I provide" and "every live arrangement" are three different
   * questions with three different audiences, and caching them together would
   * mean a DPO's oversight view invalidating a DCO's own list.
   */
  delegations: {
    mine: ["delegations", "mine"] as const,
    held: ["delegations", "held"] as const,
    all: ["delegations", "all"] as const,
  },

  users: {
    list: (params?: Params) => ["users", params ?? {}] as const,
    sessions: ["users", "sessions"] as const,
    collectionOwners: ["users", "collection-owners"] as const,
  },

  /** The data principal's own records, which are a different endpoint set from
   *  the staff-facing consent views even where the underlying row is the same. */
  me: {
    consents: ["me", "consents"] as const,
    consent: (uuid: Uuid) => ["me", "consent", uuid] as const,
    consentGrants: (uuid: Uuid) => ["me", "consent", uuid, "grants"] as const,
    consentHistory: (uuid: Uuid) => ["me", "consent", uuid, "history"] as const,
    consentNotice: (uuid: Uuid) => ["me", "consent", uuid, "notice"] as const,
    consentTrail: (uuid: Uuid) => ["me", "consent", uuid, "trail"] as const,
    disclosures: ["me", "disclosures"] as const,
  },
} as const;

/**
 * Coarse prefixes, for the invalidations that mean "anything about projects".
 *
 * A transition can change a project's approvals, its notices' publishability and
 * the dashboard's counts at once. Enumerating every affected key at each call
 * site is how one gets forgotten, so the broad strokes live here and are named.
 */
export const prefixes = {
  anyProject: ["project"] as const,
  anyCrossProjectList: ["all"] as const,
  anyNotice: ["notice"] as const,
  anyConsent: ["consent"] as const,
  anyCollection: ["collection"] as const,
  anyImport: ["import"] as const,
} as const;
