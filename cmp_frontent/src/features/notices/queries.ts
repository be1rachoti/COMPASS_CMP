/**
 * Reading notices, their purposes, languages and publish checklist.
 */
"use client";

import { useQuery } from "@tanstack/react-query";

import {
  getNotice,
  getNoticeChecklist,
  listNoticeLanguages,
  listNoticePurposes,
  listNotices,
  listProjectNotices,
} from "@/features/notices/api";
import type { ApiError } from "@/lib/errors";
import { keys, type ListFilters } from "@/lib/query";
import type {
  Notice,
  NoticeChecklist,
  NoticeLanguage,
  NoticeListRow,
  Page,
  Purpose,
  Uuid,
} from "@/types";

export function useNotices(projectUuid: Uuid | undefined) {
  return useQuery<Notice[], ApiError>({
    queryKey: keys.notice.list(projectUuid ?? ""),
    queryFn: () => listProjectNotices(projectUuid!),
    enabled: Boolean(projectUuid),
  });
}

export function useAllNotices(filters: ListFilters = {}) {
  return useQuery<Page<NoticeListRow>, ApiError>({
    queryKey: keys.notice.all(filters),
    queryFn: () => listNotices(filters),
  });
}

export function useNotice(uuid: Uuid | undefined) {
  return useQuery<Notice, ApiError>({
    queryKey: keys.notice.detail(uuid ?? ""),
    queryFn: () => getNotice(uuid!),
    enabled: Boolean(uuid),
  });
}

/**
 * `staleTime: 0` because this answer changes as a side effect of other writes.
 *
 * Attaching a purpose or approving a language moves the checklist, and the user
 * is looking at it while they do those things. A cached checklist would show
 * them a blocker they have just cleared.
 */
export function useNoticeChecklist(uuid: Uuid | undefined) {
  return useQuery<NoticeChecklist, ApiError>({
    queryKey: keys.notice.checklist(uuid ?? ""),
    queryFn: () => getNoticeChecklist(uuid!),
    enabled: Boolean(uuid),
    staleTime: 0,
  });
}

export function useNoticePurposes(uuid: Uuid | undefined) {
  return useQuery<Purpose[], ApiError>({
    queryKey: keys.notice.purposes(uuid ?? ""),
    queryFn: () => listNoticePurposes(uuid!),
    enabled: Boolean(uuid),
  });
}

export function useNoticeLanguages(uuid: Uuid | undefined) {
  return useQuery<NoticeLanguage[], ApiError>({
    queryKey: keys.notice.languages(uuid ?? ""),
    queryFn: () => listNoticeLanguages(uuid!),
    enabled: Boolean(uuid),
  });
}
