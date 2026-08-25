/**
 * Fixtures shaped like real API responses.
 *
 * Written by hand against `src/types` rather than captured from a live server,
 * for a reason worth stating: a captured fixture is a snapshot of one moment,
 * and when the API changes it keeps passing while the application breaks.
 *
 * **Nothing here is cast.** A `as Project` would make this file compile against
 * a shape that no longer exists, which is exactly the failure the fixtures are
 * meant to catch. When the API renames a field, `npm run api:types` updates
 * `src/types`, and this file stops compiling — on purpose.
 *
 * Every factory takes an override object. A test that cares about one field
 * says so and nothing else; a test that spells out fifteen fields to exercise
 * one of them has buried its own subject.
 */

import type {
  ConsentListRow,
  Me,
  NoticeListRow,
  Page,
  Project,
  Purpose,
  Role,
  User,
} from "@/types";

const NOW = "2026-02-02T11:05:00+05:30";

/**
 * The nav each role gets from the server. Mirrors the API's `NAV_BY_ROLE`.
 *
 * A copy, and a knowing one — the application never derives nav locally, but a
 * test needs a plausible `me` to render against, and one that claims a DCO can
 * see the audit trail would prove nothing. `tests/e2e/nav-coverage` checks the
 * real thing against the real server.
 */
const NAV: Record<Role, string[]> = {
  admin: [
    "dashboard", "projects", "notices", "purposes", "processors", "sources",
    "sites", "consents", "links", "exports", "imports", "collections",
    "approvals", "audit", "users", "notifications", "profile",
  ],
  dpo: [
    "dashboard", "projects", "notices", "purposes", "processors", "sources",
    "consents", "links", "exports", "collections", "approvals", "audit",
    "notifications", "profile",
  ],
  rnd_user: ["dashboard", "projects", "notices", "consents", "notifications", "profile"],
  dco: [
    "dashboard", "projects", "sites", "consents", "links", "collections",
    "imports", "notifications", "profile",
  ],
  data_subject: ["profile"],
};

export function makeMe(overrides: Partial<Me> = {}): Me {
  const role = overrides.role ?? "admin";
  return {
    uuid: "11111111-1111-4111-8111-111111111111",
    full_name: "Asha Rao",
    email: "asha.rao@organisation.example",
    role,
    person_type: null,
    status: "active",
    mfa_verified: true,
    // An hour out, so a test that does not care about expiry never trips the
    // session warning. Tests that do care set this deliberately.
    session_expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    nav: NAV[role],
    ...overrides,
  };
}

export function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    project_uuid: "22222222-2222-4222-8222-222222222222",
    project_name: "Retail footfall study",
    internal_project_name: null,
    description: "Counts visitors at partner stores to size a loyalty programme.",
    requesting_team: "Consumer Insights",
    project_status: "in_draft",
    dco_uuid: null,
    dco_name: null,
    created_by_name: "Asha Rao",
    current_notice_uuid: null,
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  };
}

export function makePurpose(overrides: Partial<Purpose> = {}): Purpose {
  return {
    purpose_uuid: "33333333-3333-4333-8333-333333333333",
    purpose_code: "LOYALTY_ENROL",
    version: 1,
    status: "active",
    name: "Loyalty programme enrolment",
    description: "Enrolling a customer in the loyalty programme.",
    uses: "Issuing a membership number and applying member pricing at checkout.",
    lawful_basis: "consent_s6",
    s7_clause: null,
    data_categories: ["contact.name", "contact.email"],
    retention_period: "P3Y",
    retention_basis: "Membership term plus statutory retention.",
    erasure_trigger: "withdrawal",
    consent_validity_period: null,
    cross_border_permitted: false,
    permitted_for_minors: false,
    lapse_behaviour: "stop_processing",
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  };
}

export function makeUser(overrides: Partial<User> = {}): User {
  return {
    uuid: "44444444-4444-4444-8444-444444444444",
    username: null,
    full_name: "Vikram Nair",
    email: "vikram.nair@organisation.example",
    mobile: null,
    organization_id: null,
    role: "dco",
    person_type: null,
    status: "active",
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  };
}

export function makeNoticeRow(overrides: Partial<NoticeListRow> = {}): NoticeListRow {
  return {
    notice_uuid: "55555555-5555-4555-8555-555555555555",
    notice_code: "NOT-0001",
    version: 1,
    status: "draft",
    published_at: null,
    created_at: NOW,
    updated_at: NOW,
    project_uuid: "22222222-2222-4222-8222-222222222222",
    project_name: "Retail footfall study",
    purpose_count: 2,
    language_count: 3,
    unapproved_languages: 1,
    ...overrides,
  };
}

export function makeConsentRow(overrides: Partial<ConsentListRow> = {}): ConsentListRow {
  return {
    consent_uuid: "66666666-6666-4666-8666-666666666666",
    subject_uuid: "77777777-7777-4777-8777-777777777777",
    subject_name: "Meera Iyer",
    subject_email: "meera.iyer@example.com",
    subject_mobile: null,
    site_uuid: "88888888-8888-4888-8888-888888888888",
    site_label: "Bengaluru — Indiranagar",
    served_at: "2026-02-02T11:04:12+05:30",
    affirmative_action_at: NOW,
    action_type: "checkbox",
    is_withdrawal: false,
    consent_status: "consented",
    granted_count: 3,
    refused_count: 0,
    project_uuid: "22222222-2222-4222-8222-222222222222",
    project_name: "Retail footfall study",
    ...overrides,
  };
}

/**
 * A page of results.
 *
 * `next_cursor` defaults to null — one page, no more. A test for pagination
 * has to set it, and by having to set it, says out loud that pagination is
 * what it is about.
 */
export function makePage<T>(
  items: T[],
  { nextCursor = null, total = null }: { nextCursor?: string | null; total?: number | null } = {},
): Page<T> {
  return { items, next_cursor: nextCursor, total };
}
