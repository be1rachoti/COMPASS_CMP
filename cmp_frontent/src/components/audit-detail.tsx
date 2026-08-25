/**
 * What one audit entry actually says.
 *
 * The trail records `notice#42`, because a surrogate key is the only reference
 * guaranteed to stay valid — codes get reused, projects get renamed, people
 * leave. Precise, and useless to read. The server resolves the pair at read time
 * into a name and a route, and this is where that lands.
 *
 * Shared by the DPO's audit trail and the data subject's notifications on
 * purpose. They are the same rows, filtered differently, and giving them two
 * renderers would mean two ideas of what an event means.
 */
"use client";

import { ArrowUpRight, Link2Off } from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { Dialog, DialogContent } from "@/components/ui/dialog";
import {
  Badge,
  Button,
  DescriptionItem,
  DescriptionList,
  Mono,
} from "@/components/ui/primitives";
import { StatusBadge } from "@/components/ui/status";
import type { AuditEntry } from "@/lib/types";
import { formatDateTime, humanise } from "@/lib/utils";

/**
 * A one-line, human reading of an event.
 *
 * Falls back to the humanised event type rather than inventing a sentence it
 * cannot support — a plausible-sounding description of an event this map does
 * not know would be a lie in an evidence log.
 */
const EVENT_SENTENCES: Record<string, string> = {
  "notice.published":
    "The notice text was frozen and hashed. From this point it cannot be edited — a correction is a new version.",
  "notice.created": "A draft notice was started.",
  "notice.updated": "A draft notice was edited.",
  "notice.language_added":
    "A language rendition was added or replaced. Replacing text clears any approval it had.",
  "notice.language_approved": "A language rendition was approved for publication.",
  "project.created": "A project was registered.",
  "project.transitioned": "The project moved to a new stage.",
  "project.updated": "Project details were edited.",
  "consent.given": "Consent was recorded against a served notice.",
  "consent.withdrawn":
    "Consent was withdrawn. The earlier record still stands as evidence of what was agreed at the time.",
  "consent.declined": "The notice was served and consent was refused.",
  "export.generated": "A file containing personal data was produced.",
  "export.downloaded": "A file containing personal data was downloaded.",
  "import.received": "A manifest was submitted.",
  "import.rejected": "A manifest was refused. Nothing was written.",
  "approval.uploaded": "A security approval and its proof file were recorded.",
  "approval.proof_downloaded": "An approval proof file was downloaded.",
  "site.created": "A collection site was registered.",
  "site.deactivated": "A collection site was closed and its links revoked.",
  "link.created": "A consent link was minted for a collection site.",
  "link.revoked": "A consent link was revoked and stopped resolving.",
  "auth.access_denied": "A request was refused by the permission matrix.",
  "auth.login_locked_out": "An account was locked after repeated failed sign-ins.",
};

export function eventSentence(entry: AuditEntry): string {
  return EVENT_SENTENCES[entry.event_type] ?? humanise(entry.event_type.replace(/\./g, " "));
}

/**
 * The sentence, unless it is only the humanised event type again.
 *
 * Where this map has no entry the fallback equals the heading, and printing the
 * heading twice reads as a rendering bug. In a listing the repetition is useful —
 * the row's own title is small — but under a dialog title it is noise.
 */
export function distinctSentence(entry: AuditEntry): string | null {
  const sentence = eventSentence(entry);
  const title = humanise(entry.event_type.replace(/\./g, " "));
  return sentence === title ? null : sentence;
}

/** The resolved entity as an inline chip: what was touched, and where it lives. */
export function EntityRef({ entry }: { entry: AuditEntry }) {
  if (!entry.entity_label) {
    // The row it described has been deleted. Saying so is more honest than
    // hiding the reference — the trail outlives what it records.
    return (
      <span className="inline-flex items-center gap-1.5 text-text-subtle">
        <Link2Off className="size-3.5" aria-hidden="true" />
        <Mono>
          {entry.entity_type}#{entry.entity_id}
        </Mono>
        <span className="text-xs">no longer exists</span>
      </span>
    );
  }

  const body = (
    <>
      {entry.entity_noun && (
        <span className="text-text-subtle">{entry.entity_noun}:</span>
      )}
      <span className="truncate">{entry.entity_label}</span>
      {entry.entity_href && (
        <ArrowUpRight
          className="size-3.5 shrink-0 opacity-60 transition-opacity group-hover:opacity-100"
          aria-hidden="true"
        />
      )}
    </>
  );

  if (!entry.entity_href) {
    return <span className="inline-flex items-center gap-1.5 text-text-muted">{body}</span>;
  }

  return (
    <Link
      href={entry.entity_href}
      className="group inline-flex max-w-full items-center gap-1.5 text-accent-text hover:underline"
    >
      {body}
    </Link>
  );
}

/**
 * The whole entry, in a dialog.
 *
 * `detail` is rendered as a list of key/value pairs rather than raw JSON where it
 * can be: the person reading this is answering a question about what happened,
 * not debugging a payload. The raw object stays available underneath, because an
 * evidence record should never hide part of itself.
 */
export function AuditDetailDialog({
  entry,
  onClose,
}: {
  entry: AuditEntry | null;
  onClose: () => void;
}) {
  if (!entry) return null;
  // Keyed on the entry so opening a different one remounts the body. That resets
  // the raw/list toggle without an effect that writes state on every open.
  return <DetailDialogBody key={entry.log_uuid} entry={entry} onClose={onClose} />;
}

function DetailDialogBody({ entry, onClose }: { entry: AuditEntry; onClose: () => void }) {
  const [raw, setRaw] = React.useState(false);

  const detail = entry.detail ?? {};
  const pairs = Object.entries(detail).filter(([key]) => !key.startsWith("_"));

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent title={humanise(entry.event_type.replace(/\./g, " "))} size="md">
        {distinctSentence(entry) && (
          <p className="text-sm leading-relaxed text-text-muted">{distinctSentence(entry)}</p>
        )}

        <div className={distinctSentence(entry) ? "mt-5" : ""}>
          <DescriptionList>
            <DescriptionItem term="What">
              <EntityRef entry={entry} />
            </DescriptionItem>

            <DescriptionItem term="When">{formatDateTime(entry.occurred_at)}</DescriptionItem>

            <DescriptionItem term="Who">
              {entry.actor_name ? (
                <span className="inline-flex flex-wrap items-center gap-1.5">
                  {entry.actor_name}
                  {entry.actor_role && (
                    <StatusBadge kind="role" value={entry.actor_role} dot={false} />
                  )}
                </span>
              ) : (
                <span className="text-text-subtle">
                  the system — no signed-in user
                </span>
              )}
            </DescriptionItem>

            {entry.subject_name && (
              <DescriptionItem term="About">
                {/* Actor and subject are usually different people: when a DCO
                    runs an export the actor is the DCO and the subject is
                    whoever the data is about. */}
                {entry.subject_name}
              </DescriptionItem>
            )}

            <DescriptionItem term="Event">
              <Mono className="text-text">{entry.event_type}</Mono>
            </DescriptionItem>

            <DescriptionItem term="Record">
              <Mono title={entry.log_uuid}>{entry.log_uuid}</Mono>
            </DescriptionItem>
          </DescriptionList>
        </div>

        {pairs.length > 0 && (
          <div className="mt-6">
            <div className="flex items-baseline justify-between gap-3">
              <h3 className="text-2xs font-semibold uppercase tracking-wider text-text-subtle">
                Recorded details
              </h3>
              <button
                type="button"
                onClick={() => setRaw((v) => !v)}
                className="text-xs text-accent-text underline underline-offset-2"
              >
                {raw ? "Show as a list" : "Show raw JSON"}
              </button>
            </div>

            {raw ? (
              <pre className="scroll-x mt-2 rounded-lg border border-border bg-bg-subtle p-3 font-mono text-2xs leading-relaxed text-text-muted">
                {JSON.stringify(detail, null, 2)}
              </pre>
            ) : (
              <dl className="mt-2 divide-y divide-border rounded-lg border border-border">
                {pairs.map(([key, value]) => (
                  <div
                    key={key}
                    className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-3 py-2"
                  >
                    <dt className="min-w-40 text-sm text-text-muted">{humanise(key)}</dt>
                    <dd className="min-w-0 flex-1 break-words text-sm text-text">
                      <DetailValue value={value} />
                    </dd>
                  </div>
                ))}
              </dl>
            )}
          </div>
        )}

        <p className="mt-6 text-xs leading-relaxed text-text-subtle">
          This entry is append-only and part of a hash chain. Nobody — including
          the Privacy Office — can edit or delete it; the database refuses the
          statement.
        </p>

        <div className="mt-5 flex justify-end gap-2">
          {entry.entity_href && (
            <Button variant="secondary" asChild>
              <Link href={entry.entity_href}>Open {entry.entity_noun?.toLowerCase() ?? "record"}</Link>
            </Button>
          )}
          <Button variant="primary" onClick={onClose}>
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function DetailValue({ value }: { value: unknown }) {
  if (value === null || value === undefined) {
    return <span className="text-text-subtle">—</span>;
  }
  if (typeof value === "boolean") {
    return <Badge tone={value ? "success" : "neutral"}>{value ? "yes" : "no"}</Badge>;
  }
  if (Array.isArray(value)) {
    return value.length === 0 ? (
      <span className="text-text-subtle">none</span>
    ) : (
      <span className="flex flex-wrap gap-1">
        {value.map((item, i) => (
          <Badge key={i} tone="neutral">
            {String(item)}
          </Badge>
        ))}
      </span>
    );
  }
  if (typeof value === "object") {
    return <Mono>{JSON.stringify(value)}</Mono>;
  }

  const text = String(value);
  // A uuid or a hash is compared character by character, so it wears the
  // monospace face; a sentence does not.
  const isToken = /^[0-9a-f-]{16,}$/i.test(text);
  return isToken ? <Mono className="text-text">{text}</Mono> : <span>{text}</span>;
}
