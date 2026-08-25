/**
 * Authoring notices and moving them toward publication.
 */
"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiPost, apiPut, http } from "@/lib/api";
import type { ApiError } from "@/lib/errors";
import type { Result } from "@/lib/query";
import type { Acknowledged, LanguageCode, Notice, Uuid } from "@/types";

export function usePublishNotice(noticeUuid: Uuid) {
  const qc = useQueryClient();
  return useMutation<Notice, ApiError, void>({
    mutationFn: () => apiPost<Notice>(`/notices/${noticeUuid}/publish`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["notice", noticeUuid] });
      void qc.invalidateQueries({ queryKey: ["project"] });
    },
  });
}

export interface NoticeInput {
  withdraw_url: string;
  exercise_rights_url: string;
  board_complaint_url: string;
  dpo_contact: string;
  /** Omit and the server mints one from the project name and the year. A DPO
   *  cannot see the other projects' codes, so asking them to invent a unique one
   *  is asking them to guess. */
  notice_code?: string | null;
  change_class?: string | null;
  /** The text a data subject actually reads, saved with the notice in one step. */
  rendered_text?: string | null;
  language_code?: string | null;
}

export function useCreateNotice(projectUuid: Uuid): Result<Notice, NoticeInput> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body) => apiPost<Notice>(`/projects/${projectUuid}/notices`, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["project", projectUuid] });
      void qc.invalidateQueries({ queryKey: ["all", "notices"] });
    },
  });
}

/**
 * Start a project's notice from one that already exists.
 *
 * The server copies rather than shares: a notice belongs to exactly one project,
 * because every consent artefact records which notice was served and a shared
 * row would make "which text, for which project" unanswerable.
 */
export function useCopyNotice(projectUuid: Uuid): Result<Notice, { source_notice_uuid: Uuid }> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body) => apiPost<Notice>(`/projects/${projectUuid}/notices/copy`, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["project", projectUuid] });
      void qc.invalidateQueries({ queryKey: ["all", "notices"] });
    },
  });
}

export function useUpdateNotice(uuid: Uuid): Result<Notice, Partial<NoticeInput>> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body) => apiPut<Notice>(`/notices/${uuid}`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notice", uuid] }),
  });
}

export function useAttachPurpose(
  noticeUuid: Uuid,
): Result<unknown, { purpose_uuid: string; display_order?: number; is_mandatory?: boolean }> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body) => apiPost(`/notices/${noticeUuid}/purposes`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notice", noticeUuid] }),
  });
}

export function useDetachPurpose(noticeUuid: Uuid): Result<void, Uuid> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (purposeUuid) => {
      await http.delete(`/notices/${noticeUuid}/purposes/${purposeUuid}`);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notice", noticeUuid] }),
  });
}

export function useSetLanguage(
  noticeUuid: Uuid,
): Result<unknown, { language_code: LanguageCode; rendered_text: string }> {
  const qc = useQueryClient();
  return useMutation({
    // The code is a query parameter on create and a path segment on update; the
    // create form is the one the console uses, and it upserts server-side.
    mutationFn: ({ language_code, rendered_text }) =>
      apiPost(`/notices/${noticeUuid}/languages?language_code=${language_code}`, {
        rendered_text,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notice", noticeUuid] }),
  });
}

export function useApproveLanguage(noticeUuid: Uuid): Result<Acknowledged, LanguageCode> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (code) =>
      apiPost<Acknowledged>(`/notices/${noticeUuid}/languages/${code}/approve`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notice", noticeUuid] }),
  });
}
