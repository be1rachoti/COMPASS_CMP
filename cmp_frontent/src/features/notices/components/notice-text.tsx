/**
 * Reading the notice.
 *
 * The console had nowhere to do this. Every screen described a notice — its
 * code, its version, its purposes, the hash of each rendition, who approved it
 * — and none of them showed the words. A DPO was asked to approve text they
 * could not read, a DCO collected against a notice they had never seen, and the
 * author's own editor opened blank because the text was not in any payload the
 * page fetched.
 *
 * So this is deliberately plain: the notice, as prose, at a width you can
 * actually read. It is not a preview of the public page — that lives at
 * `/notices/{uuid}/preview` and includes the purposes and the site list. This
 * is the one thing the rest of the page was missing.
 *
 * `whitespace-pre-wrap` rather than any markdown or HTML rendering: the stored
 * text is exactly what a data principal is served and exactly what is hashed,
 * so showing it any other way would show something that is not the notice.
 */
"use client";

import { Check, Languages as LanguagesIcon, Pencil, TriangleAlert } from "lucide-react";
import * as React from "react";

import {
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  EmptyState,
  Mono,
  Skeleton,
} from "@/components/ui/primitives";
import { formatDateTime, shortHash } from "@/lib/format";
import type { NoticeLanguage } from "@/types";

export function NoticeText({
  languages,
  isLoading,
  canEdit,
  onEdit,
}: {
  languages: NoticeLanguage[] | undefined;
  isLoading: boolean;
  /** Authors, and only while the notice is a draft. A published notice is
   *  frozen and the database refuses the edit either way. */
  canEdit: boolean;
  onEdit: (lang: NoticeLanguage) => void;
}) {
  // English first when it exists, because it is the one rendition s.5(3)
  // guarantees and the one most readers of this screen can check.
  const ordered = React.useMemo(
    () =>
      [...(languages ?? [])].sort((a, b) =>
        a.language_code === "english" ? -1 : b.language_code === "english" ? 1 : 0,
      ),
    [languages],
  );

  const [selected, setSelected] = React.useState<string | null>(null);
  const showing = ordered.find((l) => l.language_code === selected) ?? ordered[0];

  if (isLoading) {
    return (
      <Card>
        <CardBody>
          <Skeleton className="h-48" />
        </CardBody>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle className="flex items-center gap-2">
            <LanguagesIcon className="size-4" aria-hidden="true" />
            Notice text
          </CardTitle>
          <p className="mt-1 text-xs text-text-muted">
            Exactly what a data principal reads, and exactly what is hashed at publication.
          </p>
        </div>

        {canEdit && showing && (
          <Button variant="secondary" size="sm" onClick={() => onEdit(showing)}>
            <Pencil className="size-4" />
            Edit this rendition
          </Button>
        )}
      </CardHeader>

      {!showing ? (
        <EmptyState
          title="No text yet"
          description="A notice cannot be submitted for review, or published, until it says something."
        />
      ) : (
        <CardBody className="space-y-3">
          {/* Only when there is a choice to make. One rendition and a row of
              one button is furniture. */}
          {ordered.length > 1 && (
            <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Language">
              {ordered.map((lang) => {
                const active = lang.language_code === showing.language_code;
                return (
                  <button
                    key={lang.notice_language_uuid}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => setSelected(lang.language_code)}
                    className={
                      "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium capitalize transition-colors " +
                      (active
                        ? "border-accent-border bg-accent-subtle text-accent-text"
                        : "border-border text-text-muted hover:bg-bg-inset")
                    }
                  >
                    {lang.language_code}
                    {/* The approval state travels with the tab, so somebody
                        reading a translation knows whether anybody has signed
                        it off before they rely on it. */}
                    {lang.approved_at ? (
                      <Check className="size-3 text-success" aria-hidden="true" />
                    ) : (
                      <TriangleAlert className="size-3 text-warning" aria-hidden="true" />
                    )}
                  </button>
                );
              })}
            </div>
          )}

          <div className="rounded-lg border border-border bg-bg-subtle p-4 sm:p-5">
            <p className="max-w-[68ch] whitespace-pre-wrap text-sm leading-relaxed text-text">
              {showing.rendered_text}
            </p>
          </div>

          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-subtle">
            <span>
              sha256 <Mono>{shortHash(showing.content_hash)}</Mono>
            </span>
            {showing.approved_at ? (
              <span className="inline-flex items-center gap-1 text-success-text">
                <Check className="size-3.5" aria-hidden="true" />
                Legally approved by {showing.approved_by_name} ·{" "}
                {formatDateTime(showing.approved_at)}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-warning-text">
                <TriangleAlert className="size-3.5" aria-hidden="true" />
                Not legally approved — the project cannot be approved until it is
              </span>
            )}
          </p>
        </CardBody>
      )}
    </Card>
  );
}
