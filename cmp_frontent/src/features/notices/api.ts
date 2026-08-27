/**
 * Every request the notices feature makes.
 *
 * A notice is the document a data principal is shown before being asked for
 * consent, and it is frozen and content-hashed at publication. That shapes the
 * endpoints: everything before `publishNotice` is editable, and nothing after
 * it is — a change to a published notice is a new version, not an update.
 */

import { apiGet, apiPost, apiPut, http, queryString } from "@/lib/api";
import type { ListFilters } from "@/lib/query";
import type {
  Acknowledged,
  LanguageCode,
  Notice,
  NoticeChecklist,
  NoticeLanguage,
  NoticeListRow,
  Page,
  PurposeOnNotice,
  Uuid,
} from "@/types";

/* ----------------------------------------------------------------- reads */

export function listProjectNotices(projectUuid: Uuid): Promise<Notice[]> {
  return apiGet<Notice[]>(`/projects/${projectUuid}/notices`);
}

/** Notices across every project the caller may see. */
export function listNotices(filters: ListFilters = {}): Promise<Page<NoticeListRow>> {
  return apiGet<Page<NoticeListRow>>(`/notices${queryString(filters)}`);
}

export function getNotice(uuid: Uuid): Promise<Notice> {
  return apiGet<Notice>(`/notices/${uuid}`);
}

/**
 * What still stands between this notice and publication.
 *
 * Computed server-side from the same rules publication enforces, so the
 * checklist and the publish button can never disagree — which they would the
 * first time somebody added a rule in one place.
 */
export function getNoticeChecklist(uuid: Uuid): Promise<NoticeChecklist> {
  return apiGet<NoticeChecklist>(`/notices/${uuid}/checklist`);
}

export function listNoticePurposes(uuid: Uuid): Promise<PurposeOnNotice[]> {
  return apiGet<PurposeOnNotice[]>(`/notices/${uuid}/purposes`);
}

export function listNoticeLanguages(uuid: Uuid): Promise<NoticeLanguage[]> {
  return apiGet<NoticeLanguage[]>(`/notices/${uuid}/languages`);
}

/* ---------------------------------------------------------------- writes */

export interface NoticeInput {
  withdraw_url: string;
  exercise_rights_url: string;
  board_complaint_url: string;
  dpo_contact: string;
  /**
   * Omit and the server mints one from the project name and the year. A DPO
   * cannot see other projects' codes, so asking them to invent a unique one is
   * asking them to guess.
   */
  notice_code?: string | null;
  /** Who this notice addresses. Required before publication, checked there
   *  rather than here so a notice can be started before it is settled. */
  applicable_to?: string | null;
  /** A note to whoever collects against it. Never served to a data principal. */
  note?: string | null;
  change_class?: string | null;
  /** The text a data principal actually reads, saved with the notice in one step. */
  rendered_text?: string | null;
  language_code?: string | null;
}

export interface PurposeAttachment {
  purpose_uuid: string;
  display_order?: number;
  is_mandatory?: boolean;
}

export interface LanguageInput {
  language_code: LanguageCode;
  rendered_text: string;
}

export function createNotice(projectUuid: Uuid, body: NoticeInput): Promise<Notice> {
  return apiPost<Notice>(`/projects/${projectUuid}/notices`, body);
}

/**
 * Start a project's notice from one that already exists.
 *
 * The server copies rather than shares. A notice belongs to exactly one
 * project, because every consent artefact records which notice was served, and
 * a shared row would make "which text, for which project" unanswerable.
 */
export function copyNotice(
  projectUuid: Uuid,
  body: { source_notice_uuid: Uuid },
): Promise<Notice> {
  return apiPost<Notice>(`/projects/${projectUuid}/notices/copy`, body);
}

export function updateNotice(uuid: Uuid, body: Partial<NoticeInput>): Promise<Notice> {
  return apiPut<Notice>(`/notices/${uuid}`, body);
}

/** Freezes the text and writes its content hash. Not reversible. */
export function publishNotice(uuid: Uuid): Promise<Notice> {
  return apiPost<Notice>(`/notices/${uuid}/publish`);
}

export function attachPurpose(noticeUuid: Uuid, body: PurposeAttachment): Promise<unknown> {
  return apiPost(`/notices/${noticeUuid}/purposes`, body);
}

export async function detachPurpose(noticeUuid: Uuid, purposeUuid: Uuid): Promise<void> {
  await http.delete(`/notices/${noticeUuid}/purposes/${purposeUuid}`);
}

/**
 * Add or replace a language rendition.
 *
 * The code is a query parameter here and a path segment on the update route.
 * This is the form the console uses, because it upserts server-side — the
 * caller does not have to know whether the rendition already exists.
 */
export function setNoticeLanguage(
  noticeUuid: Uuid,
  { language_code, rendered_text }: LanguageInput,
): Promise<unknown> {
  return apiPost(`/notices/${noticeUuid}/languages?language_code=${language_code}`, {
    rendered_text,
  });
}

export function approveNoticeLanguage(
  noticeUuid: Uuid,
  code: LanguageCode,
): Promise<Acknowledged> {
  return apiPost<Acknowledged>(`/notices/${noticeUuid}/languages/${code}/approve`);
}

/**
 * Rule 3(b) as one notice states it.
 *
 * Both null clears the override and the notice reverts to the purpose's own
 * wording — the same operation as "reset", so there is no separate call for it.
 */
export interface PurposeOverride {
  /** Rule 3(b)(i): the personal data collected, itemised. Must be a subset of
   *  the purpose's own list — a notice narrows, never widens. */
  data_categories?: string[] | null;
  /** Rule 3(b)(ii): the specific uses this notice enables. */
  uses?: string | null;
}

/**
 * Narrow Rule 3(b) for this notice without touching the shared purpose.
 *
 * A purpose is reference data attached to many notices, and its category list
 * covers every collection it might serve. A specific project usually takes
 * less. Before this, saying so meant editing the purpose and changing every
 * other notice using it.
 */
export function overrideNoticePurpose(
  noticeUuid: Uuid,
  purposeUuid: Uuid,
  body: PurposeOverride,
): Promise<Acknowledged> {
  return apiPut<Acknowledged>(`/notices/${noticeUuid}/purposes/${purposeUuid}`, body);
}
