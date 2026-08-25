/**
 * Step three: read the notice and choose.
 *
 * The screen the whole system is built around, and the one where the statutory
 * requirements are the design:
 *
 * - **Nothing is pre-ticked.** s.6(1) requires an affirmative action, and a
 *   pre-ticked box is not one.
 * - **Accept and Decline are equally prominent.** Making refusal harder to find
 *   than agreement is precisely the dark pattern the Act is aimed at.
 * - **`served_at` is echoed back untouched.** It evidences s.5(1) — that the
 *   notice was given before consent was asked for.
 * - **Every purpose is submitted, including the refused ones.** An absent key
 *   would be indistinguishable from a purpose never shown, and "she refused
 *   this" and "she was never asked" are different facts.
 */
"use client";

import { Check, FileText, Globe, X } from "lucide-react";
import * as React from "react";

import {
  Alert,
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  Mono,
  Select,
} from "@/components/ui/primitives";
import { recordConsent } from "@/features/public-consent/api";
import { ApiError } from "@/lib/errors";
import { humanise, shortHash } from "@/lib/format";
import type { LanguageCode, ServedNotice } from "@/types";

import { LANGUAGE_NAMES } from "@/features/public-consent/components/languages";
import { PurposeChoice } from "@/features/public-consent/components/purpose-choice";

export function NoticeStep({
  token,
  notice,
  languages,
  language,
  onLanguageChange,
  onDone,
  onError,
}: {
  token: string;
  notice: ServedNotice;
  languages: LanguageCode[];
  language: LanguageCode;
  onLanguageChange: (code: LanguageCode) => void;
  onDone: (uuid: string, declined: boolean) => void;
  onError: (message: string | null) => void;
}) {
  // Nothing pre-ticked: consent must be an affirmative action.
  const [grants, setGrants] = React.useState<Record<string, boolean>>({});
  const [busy, setBusy] = React.useState(false);

  const purposes = notice.purposes;
  const mandatory = purposes.filter((p) => p.is_mandatory);
  const allAnswered = purposes.every((p) => p.purpose_uuid in grants);

  async function submit(decision: "accept" | "decline") {
    setBusy(true);
    onError(null);

    // Declining answers every purpose with a No. Every purpose must carry an
    // explicit answer - silence is not consent, and the API rejects a partial
    // set rather than assuming.
    const payload =
      decision === "decline"
        ? Object.fromEntries(purposes.map((p) => [p.purpose_uuid, false]))
        : Object.fromEntries(purposes.map((p) => [p.purpose_uuid, grants[p.purpose_uuid] ?? false]));

    try {
      const result = await recordConsent(token, {
        language_code: notice.language_code,
        served_at: notice.served_at, // echoed untouched - evidences s.5(1)
        grants: payload,
        action_type: "checkbox_click",
      });
      onDone(result.consent_uuid, decision === "decline");
    } catch (err) {
      onError(
        err instanceof ApiError ? err.userMessage() : "Your choices could not be recorded.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {languages.length > 1 && (
        <div className="flex items-center gap-2">
          <Globe className="size-4 text-text-muted" aria-hidden="true" />
          <label htmlFor="lang" className="text-sm text-text-muted">
            Read this in
          </label>
          <Select
            id="lang"
            value={language}
            onChange={(e) => onLanguageChange(e.target.value as LanguageCode)}
            className="w-44"
          >
            {languages.map((code) => (
              <option key={code} value={code}>
                {LANGUAGE_NAMES[code] ?? humanise(code)}
              </option>
            ))}
          </Select>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="size-4" aria-hidden="true" />
            The notice
          </CardTitle>
        </CardHeader>
        <CardBody>
          <div className="whitespace-pre-wrap text-sm leading-relaxed text-text">
            {notice.rendered_text}
          </div>

          <dl className="mt-5 space-y-2 border-t border-border pt-4 text-xs">
            <div className="flex flex-wrap gap-x-2">
              <dt className="text-text-subtle">Data Protection Officer:</dt>
              <dd>{notice.notice.dpo_contact}</dd>
            </div>
            {notice.notice.recipients_text && (
              <div className="flex flex-wrap gap-x-2">
                <dt className="text-text-subtle">Who else sees your data:</dt>
                <dd>{notice.notice.recipients_text}</dd>
              </div>
            )}
            <div className="flex flex-wrap gap-x-3 pt-1">
              <a
                href={notice.notice.exercise_rights_url}
                className="text-accent-text underline underline-offset-2"
              >
                Exercise your rights
              </a>
              <a
                href={notice.notice.withdraw_url}
                className="text-accent-text underline underline-offset-2"
              >
                Withdraw consent
              </a>
              <a
                href={notice.notice.board_complaint_url}
                className="text-accent-text underline underline-offset-2"
              >
                Complain to the Data Protection Board
              </a>
            </div>
            <div className="pt-1 text-text-subtle">
              Version {notice.notice.version} · content hash{" "}
              <Mono>{shortHash(notice.content_hash)}</Mono>
            </div>
          </dl>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>What are you agreeing to?</CardTitle>
          <p className="mt-1 text-sm text-text-muted">
            Choose for each purpose separately. You can say yes to some and no to
            others, and you can change your mind at any time.
          </p>
        </CardHeader>
        <CardBody className="space-y-3">
          {purposes.map((purpose) => (
            <PurposeChoice
              key={purpose.purpose_uuid}
              purpose={purpose}
              value={grants[purpose.purpose_uuid]}
              onChange={(value) =>
                setGrants((current) => ({ ...current, [purpose.purpose_uuid]: value }))
              }
            />
          ))}

          {mandatory.length > 0 && (
            <Alert tone="warning">
              {mandatory.length === 1 ? "One purpose" : `${mandatory.length} purposes`} on
              this notice cannot be refused. If you are not willing to agree to
              {mandatory.length === 1 ? " it" : " them"}, decline the whole notice below.
            </Alert>
          )}
        </CardBody>
      </Card>

      {/* Accept and decline are given equal weight on purpose. */}
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button
          variant="primary"
          className="flex-1"
          loading={busy}
          disabled={!allAnswered}
          onClick={() => void submit("accept")}
        >
          <Check className="size-4" />
          Record my choices
        </Button>
        <Button
          variant="secondary"
          className="flex-1"
          loading={busy}
          onClick={() => void submit("decline")}
        >
          <X className="size-4" />
          Decline everything
        </Button>
      </div>

      {!allAnswered && (
        <p className="text-center text-xs text-text-subtle">
          Answer every purpose above, or decline the whole notice.
        </p>
      )}
    </div>
  );
}
