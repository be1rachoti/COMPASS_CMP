/**
 * Authoring notices and moving them toward publication.
 *
 * Every write here invalidates `keys.notice.detail(uuid)`, which is the prefix
 * the checklist, purposes and languages all sit under — so one invalidation
 * refreshes the whole editing surface. That is deliberate: attaching a purpose
 * changes the checklist, and a user who has just cleared a blocker should not
 * still be looking at it.
 */
"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";

import {
  activateNoticePurposes,
  approveNoticeLanguage,
  attachPurpose,
  copyNotice,
  createNotice,
  detachPurpose,
  importNoticeDocument,
  publishNotice,
  setNoticeLanguage,
  overrideNoticePurpose,
  updateNotice,
  validateNoticeDocument,
  type LanguageInput,
  type NoticeInput,
  type PurposeAttachment,
  type PurposeOverride,
} from "@/features/notices/api";
import { keys, prefixes, type Result } from "@/lib/query";
import type {
  Acknowledged,
  LanguageCode,
  Notice,
  NoticeDocumentReport,
  Uuid,
} from "@/types";

export type { LanguageInput, NoticeInput, PurposeAttachment, PurposeOverride };

export function useCreateNotice(projectUuid: Uuid): Result<Notice, NoticeInput> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: NoticeInput) => createNotice(projectUuid, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.project.detail(projectUuid) });
      void qc.invalidateQueries({ queryKey: keys.notice.all() });
    },
  });
}

export function useCopyNotice(projectUuid: Uuid): Result<Notice, { source_notice_uuid: Uuid }> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { source_notice_uuid: Uuid }) => copyNotice(projectUuid, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.project.detail(projectUuid) });
      void qc.invalidateQueries({ queryKey: keys.notice.all() });
    },
  });
}

export function useUpdateNotice(uuid: Uuid): Result<Notice, Partial<NoticeInput>> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Partial<NoticeInput>) => updateNotice(uuid, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.notice.detail(uuid) }),
  });
}

/**
 * Publish, which freezes the text and writes its content hash.
 *
 * Invalidates the project prefix as well as the notice: publication is what
 * unblocks the project's own transition, so the button the user is heading for
 * next is stale the moment this succeeds.
 */
export function usePublishNotice(noticeUuid: Uuid): Result<Notice, void> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => publishNotice(noticeUuid),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.notice.detail(noticeUuid) });
      void qc.invalidateQueries({ queryKey: prefixes.anyProject });
      void qc.invalidateQueries({ queryKey: keys.notice.all() });
    },
  });
}

export function useAttachPurpose(noticeUuid: Uuid): Result<unknown, PurposeAttachment> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: PurposeAttachment) => attachPurpose(noticeUuid, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.notice.detail(noticeUuid) }),
  });
}

export function useDetachPurpose(noticeUuid: Uuid): Result<void, Uuid> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (purposeUuid: Uuid) => detachPurpose(noticeUuid, purposeUuid),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.notice.detail(noticeUuid) }),
  });
}

export function useSetLanguage(noticeUuid: Uuid): Result<unknown, LanguageInput> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: LanguageInput) => setNoticeLanguage(noticeUuid, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.notice.detail(noticeUuid) }),
  });
}

export function useApproveLanguage(noticeUuid: Uuid): Result<Acknowledged, LanguageCode> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (code: LanguageCode) => approveNoticeLanguage(noticeUuid, code),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.notice.detail(noticeUuid) }),
  });
}

/**
 * Narrow Rule 3(b) on this notice.
 *
 * Invalidates the notice prefix, which reaches its purposes *and* its checklist:
 * the checklist reads what the notice actually says, so an override that
 * changed the itemised categories changes what is left to do.
 */
export function useOverrideNoticePurpose(
  noticeUuid: Uuid,
): Result<Acknowledged, { purposeUuid: Uuid; body: PurposeOverride }> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ purposeUuid, body }: { purposeUuid: Uuid; body: PurposeOverride }) =>
      overrideNoticePurpose(noticeUuid, purposeUuid, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.notice.detail(noticeUuid) }),
  });
}

/* ------------------------------------------------- from an uploaded document */

/**
 * Dry run of a notice document.
 *
 * A mutation rather than a query even though it writes nothing: it is an action
 * the user takes with a file they picked, not a value that can be refetched.
 */
export function useValidateNoticeDocument(projectUuid: Uuid) {
  return useMutation<NoticeDocumentReport, Error, File>({
    mutationFn: (file) => validateNoticeDocument(projectUuid, file),
  });
}

export function useImportNoticeDocument(projectUuid: Uuid) {
  const qc = useQueryClient();
  return useMutation<Notice, Error, File>({
    mutationFn: (file) => importNoticeDocument(projectUuid, file),
    onSuccess: () => {
      // The import creates a notice, its rendition and its purposes at once, so
      // the project surface, the notice list and the register all go stale
      // together.
      void qc.invalidateQueries({ queryKey: keys.notice.all() });
      void qc.invalidateQueries({ queryKey: keys.project.detail(projectUuid) });
      void qc.invalidateQueries({ queryKey: ["purposes"] });
    },
  });
}

/** The DPO activating every draft purpose an import left on a notice. */
export function useActivateNoticePurposes(noticeUuid: Uuid) {
  const qc = useQueryClient();
  return useMutation<Acknowledged, Error, void>({
    mutationFn: () => activateNoticePurposes(noticeUuid),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.notice.detail(noticeUuid) });
      void qc.invalidateQueries({ queryKey: ["purposes"] });
    },
  });
}
