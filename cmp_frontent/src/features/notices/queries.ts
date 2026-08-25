/**
 * Reading notices, their purposes, languages and publish checklist.
 */
"use client";

import { useQuery } from "@tanstack/react-query";
import { apiGet, queryString } from "@/lib/api";
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
    queryFn: () => apiGet<Notice[]>(`/projects/${projectUuid}/notices`),
    enabled: Boolean(projectUuid),
  });
}

export function useNotice(uuid: Uuid | undefined) {
  return useQuery<Notice, ApiError>({
    queryKey: keys.notice.detail(uuid ?? ""),
    queryFn: () => apiGet<Notice>(`/notices/${uuid}`),
    enabled: Boolean(uuid),
  });
}

export function useNoticeChecklist(uuid: Uuid | undefined) {
  return useQuery<NoticeChecklist, ApiError>({
    queryKey: keys.notice.checklist(uuid ?? ""),
    queryFn: () => apiGet<NoticeChecklist>(`/notices/${uuid}/checklist`),
    enabled: Boolean(uuid),
    staleTime: 0,
  });
}

export function useNoticePurposes(uuid: Uuid | undefined) {
  return useQuery<Purpose[], ApiError>({
    queryKey: keys.notice.purposes(uuid ?? ""),
    queryFn: () => apiGet<Purpose[]>(`/notices/${uuid}/purposes`),
    enabled: Boolean(uuid),
  });
}

export function useNoticeLanguages(uuid: Uuid | undefined) {
  return useQuery<NoticeLanguage[], ApiError>({
    queryKey: keys.notice.languages(uuid ?? ""),
    queryFn: () => apiGet<NoticeLanguage[]>(`/notices/${uuid}/languages`),
    enabled: Boolean(uuid),
  });
}

export function useAllNotices(filters: ListFilters = {}) {
  return useQuery<Page<NoticeListRow>, ApiError>({
    queryKey: keys.notice.all(filters),
    queryFn: () => apiGet<Page<NoticeListRow>>(`/notices${queryString(filters)}`),
  });
}
