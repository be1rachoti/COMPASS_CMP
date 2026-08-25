/**
 * The public consent flow.
 *
 * This is the only screen a data subject is required to use, and it is the one
 * that has to be right. Four steps: validate the link, register, confirm the
 * contact, read the notice and choose.
 *
 * Decisions that are not cosmetic:
 *
 * - **Nothing is pre-ticked.** Consent has to be an affirmative action; a
 *   pre-ticked box is not one.
 * - **Accept and Decline are equally prominent.** Making refusal harder to find
 *   than agreement is exactly the dark pattern the statute is aimed at, and
 *   withdrawing must be as easy as giving.
 * - **`served_at` comes from the server** and is echoed back untouched. It is
 *   what evidences s.5(1) - that the notice was given before consent was asked
 *   for - and a client-supplied timestamp would make that unfalsifiable.
 * - **An invalid link renders no notice content**, only a plain message.
 */
"use client";

import { AlertCircle, Check, FileText, Globe, X } from "lucide-react";
import { useParams } from "next/navigation";
import * as React from "react";

import { Pipeline } from "@/components/ui/charts";
import { BrandMark, SignalField } from "@/components/ui/graphics";
import {
  Alert,
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  Field,
  Input,
  Mono,
  Select,
  Skeleton,
} from "@/components/ui/primitives";
import { apiGet, apiPost } from "@/lib/api";
import { ApiError } from "@/lib/errors";
import type { LanguageCode, LinkView, Purpose, ServedNotice } from "@/types";
import { formatDuration, humanise, shortHash } from "@/lib/format";

type Step = "loading" | "invalid" | "register" | "verify" | "notice" | "done";

const LANGUAGE_NAMES: Record<string, string> = {
  english: "English",
  hindi: "हिन्दी",
  marathi: "मराठी",
  tamil: "தமிழ்",
  telugu: "తెలుగు",
  kannada: "ಕನ್ನಡ",
  bengali: "বাংলা",
  gujarati: "ગુજરાતી",
};

export default function ConsentPage() {
  const { token } = useParams<{ token: string }>();

  const [step, setStep] = React.useState<Step>("loading");
  const [link, setLink] = React.useState<LinkView | null>(null);
  const [contact, setContact] = React.useState("");
  const [language, setLanguage] = React.useState<LanguageCode>("english");
  const [notice, setNotice] = React.useState<ServedNotice | null>(null);
  const [receipt, setReceipt] = React.useState<{ uuid: string; declined: boolean } | null>(
    null,
  );
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    apiGet<LinkView>(`/c/${token}`)
      .then((data) => {
        if (cancelled) return;
        setLink(data);
        setLanguage(data.available_languages[0] ?? "english");
        setStep("register");
      })
      .catch(() => {
        if (!cancelled) setStep("invalid");
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (step === "loading") {
    return (
      <Shell>
        <Card>
          <CardBody className="space-y-3">
            <Skeleton className="h-6 w-2/3" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
          </CardBody>
        </Card>
      </Shell>
    );
  }

  // Deliberately says nothing about *why*. Distinguishing expired from revoked
  // from unknown tells a token-guesser which of their guesses was structurally
  // valid.
  if (step === "invalid") {
    return (
      <Shell>
        <Card>
          <CardBody className="py-10 text-center">
            <AlertCircle className="mx-auto size-8 text-text-subtle" aria-hidden="true" />
            <h1 className="mt-4 text-lg font-semibold">This link is not valid</h1>
            <p className="mx-auto mt-2 max-w-sm text-sm text-text-muted">
              It may have expired, been withdrawn, or been mistyped. Please ask the
              person who gave it to you for a current one.
            </p>
            <p className="mt-6 text-xs text-text-subtle">
              <a href="/rights" className="underline underline-offset-2">
                Your rights under the DPDP Act
              </a>
            </p>
          </CardBody>
        </Card>
      </Shell>
    );
  }

  return (
    <Shell projectName={link?.project_name} siteLabel={link?.site_label}>
      {error && (
        <Alert tone="danger" className="mb-4">
          {error}
        </Alert>
      )}

      <Steps current={step} />

      {step === "register" && (
        <RegisterStep
          token={token}
          onDone={(email) => {
            setContact(email);
            setError(null);
            setStep("verify");
          }}
          onError={setError}
        />
      )}

      {step === "verify" && (
        <VerifyStep
          token={token}
          contact={contact}
          onDone={async () => {
            setError(null);
            try {
              const served = await apiGet<ServedNotice>(
                `/c/${token}/notice?language_code=${language}`,
              );
              setNotice(served);
              setStep("notice");
            } catch (err) {
              setError(
                err instanceof ApiError ? err.userMessage() : "Could not load the notice.",
              );
            }
          }}
          onError={setError}
        />
      )}

      {step === "notice" && notice && (
        <NoticeStep
          token={token}
          notice={notice}
          languages={link?.available_languages ?? []}
          language={language}
          onLanguageChange={async (next) => {
            setLanguage(next);
            try {
              // Re-serving stamps a fresh `served_at`: she is now reading a
              // different rendition, and the evidence must record which one.
              const served = await apiGet<ServedNotice>(
                `/c/${token}/notice?language_code=${next}`,
              );
              setNotice(served);
            } catch {
              setError("Could not switch language.");
            }
          }}
          onDone={(uuid, declined) => {
            setReceipt({ uuid, declined });
            setStep("done");
          }}
          onError={setError}
        />
      )}

      {step === "done" && receipt && <DoneStep receipt={receipt} />}
    </Shell>
  );
}

function Shell({
  children,
  projectName,
  siteLabel,
}: {
  children: React.ReactNode;
  projectName?: string;
  siteLabel?: string;
}) {
  return (
    <div className="min-h-dvh bg-bg-subtle">
      {/* The banner is the only branded surface in the flow. Everything below it
          is plain, high-contrast reading material: this is a legal notice, and
          it should not look like a marketing page. */}
      <header className="brand-gradient relative overflow-hidden">
        <SignalField className="absolute -right-16 -top-24 h-64 w-64 text-white/40" />
        <div className="relative mx-auto flex max-w-2xl items-center gap-3 px-4 py-5">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-white/15 ring-1 ring-white/25">
            <BrandMark className="size-6 text-white" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-white">
              {projectName ?? "Consent"}
            </p>
            <p className="truncate text-xs text-white/75">
              {siteLabel ?? "Digital Personal Data Protection Act 2023"}
            </p>
          </div>
        </div>
      </header>

      <main id="main" className="mx-auto max-w-2xl px-4 py-8 sm:py-10">
        {children}

        <p className="mt-8 text-center text-xs text-text-subtle">
          <a href="/rights" className="underline underline-offset-2 hover:text-text-muted">
            Your rights under the DPDP Act
          </a>
        </p>
      </main>
    </div>
  );
}

const STEP_LABELS: Array<{ key: Step; label: string }> = [
  { key: "register", label: "Your details" },
  { key: "verify", label: "Confirm" },
  { key: "notice", label: "The notice" },
  { key: "done", label: "Done" },
];

function Steps({ current }: { current: Step }) {
  const index = STEP_LABELS.findIndex((s) => s.key === current);
  return (
    <div className="mb-5">
      <Pipeline steps={STEP_LABELS} currentIndex={index} />
    </div>
  );
}

function RegisterStep({
  token,
  onDone,
  onError,
}: {
  token: string;
  onDone: (email: string) => void;
  onError: (message: string | null) => void;
}) {
  const [form, setForm] = React.useState({ full_name: "", email: "", mobile: "" });
  const [busy, setBusy] = React.useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    onError(null);
    try {
      await apiPost(`/c/${token}/register`, {
        full_name: form.full_name,
        email: form.email,
        mobile: form.mobile || undefined,
        person_type: "external",
      });
      await apiPost(`/c/${token}/otp`, { contact: form.email });
      onDone(form.email);
    } catch (err) {
      onError(err instanceof ApiError ? err.userMessage() : "Could not register.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Your details</CardTitle>
        <p className="mt-1 text-sm text-text-muted">
          We need these to record your consent and to let you review or withdraw it
          later.
        </p>
      </CardHeader>
      <CardBody>
        <form onSubmit={submit} className="space-y-4" noValidate>
          <Field label="Full name" required>
            {(props) => (
              <Input
                {...props}
                value={form.full_name}
                onChange={(e) => setForm({ ...form, full_name: e.target.value })}
                autoComplete="name"
                required
              />
            )}
          </Field>
          <Field label="Email" hint="We will send a six-digit code to confirm it." required>
            {(props) => (
              <Input
                {...props}
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                autoComplete="email"
                required
              />
            )}
          </Field>
          <Field label="Mobile" hint="Optional.">
            {(props) => (
              <Input
                {...props}
                type="tel"
                value={form.mobile}
                onChange={(e) => setForm({ ...form, mobile: e.target.value })}
                autoComplete="tel"
                placeholder="+91 ..."
              />
            )}
          </Field>
          <Button type="submit" variant="primary" className="w-full" loading={busy}>
            Continue
          </Button>
        </form>
      </CardBody>
    </Card>
  );
}

function VerifyStep({
  token,
  contact,
  onDone,
  onError,
}: {
  token: string;
  contact: string;
  onDone: () => void;
  onError: (message: string | null) => void;
}) {
  const [code, setCode] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    onError(null);
    try {
      await apiPost(`/c/${token}/otp/verify`, { contact, code });
      await onDone();
    } catch (err) {
      onError(err instanceof ApiError ? err.userMessage() : "Verification failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Confirm your email</CardTitle>
        <p className="mt-1 text-sm text-text-muted">
          We have sent a six-digit code to <strong>{contact}</strong>. It expires in
          ten minutes.
        </p>
      </CardHeader>
      <CardBody>
        <form onSubmit={submit} className="space-y-4" noValidate>
          <Field label="Six-digit code" required>
            {(props) => (
              <Input
                {...props}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="000000"
                className="text-center font-mono text-lg tracking-[0.4em]"
                autoFocus
              />
            )}
          </Field>
          <Button
            type="submit"
            variant="primary"
            className="w-full"
            loading={busy}
            disabled={code.length !== 6}
          >
            Confirm and read the notice
          </Button>
        </form>
      </CardBody>
    </Card>
  );
}

function NoticeStep({
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
      const result = await apiPost<{ consent_uuid: string }>(`/c/${token}/consent`, {
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

function PurposeChoice({
  purpose,
  value,
  onChange,
}: {
  purpose: Purpose;
  value: boolean | undefined;
  onChange: (value: boolean) => void;
}) {
  const name = `purpose-${purpose.purpose_uuid}`;

  return (
    <fieldset className="rounded-md border border-border p-4">
      <legend className="px-1 text-sm font-medium">{purpose.name}</legend>

      <p className="text-sm text-text-muted">{purpose.description}</p>
      <p className="mt-2 text-xs text-text-muted">
        <span className="font-medium text-text">What this allows: </span>
        {purpose.uses}
      </p>

      <dl className="mt-3 grid gap-1 text-xs text-text-subtle sm:grid-cols-2">
        <div>
          <dt className="inline font-medium">Data collected: </dt>
          <dd className="inline">
            {purpose.data_categories.map((c) => humanise(c)).join(", ")}
          </dd>
        </div>
        <div>
          <dt className="inline font-medium">Kept for: </dt>
          <dd className="inline">{formatDuration(purpose.retention_period)}</dd>
        </div>
      </dl>

      <div className="mt-3 flex gap-2" role="radiogroup" aria-label={`Your choice for ${purpose.name}`}>
        <label
          className={[
            "flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm",
            value === true
              ? "border-success-border bg-success-subtle text-success-text font-medium"
              : "border-border hover:bg-surface-hover",
          ].join(" ")}
        >
          <input
            type="radio"
            name={name}
            className="sr-only"
            checked={value === true}
            onChange={() => onChange(true)}
          />
          <Check className="size-4" aria-hidden="true" />I agree
        </label>

        <label
          className={[
            "flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm",
            value === false
              ? "border-border-strong bg-bg-inset text-text font-medium"
              : "border-border hover:bg-surface-hover",
            purpose.is_mandatory ? "cursor-not-allowed opacity-50" : "",
          ].join(" ")}
        >
          <input
            type="radio"
            name={name}
            className="sr-only"
            checked={value === false}
            disabled={purpose.is_mandatory}
            onChange={() => onChange(false)}
          />
          <X className="size-4" aria-hidden="true" />
          {purpose.is_mandatory ? "Cannot be refused" : "I do not agree"}
        </label>
      </div>
    </fieldset>
  );
}

function DoneStep({ receipt }: { receipt: { uuid: string; declined: boolean } }) {
  return (
    <Card>
      <CardBody className="py-10 text-center">
        <div
          className={[
            "mx-auto grid size-12 place-items-center rounded-full",
            receipt.declined ? "bg-bg-inset" : "bg-success-subtle",
          ].join(" ")}
        >
          {receipt.declined ? (
            <X className="size-6 text-text-muted" aria-hidden="true" />
          ) : (
            <Check className="size-6 text-success-text" aria-hidden="true" />
          )}
        </div>

        <h1 className="mt-4 text-lg font-semibold">
          {receipt.declined ? "You have declined" : "Your choices are recorded"}
        </h1>

        <p className="mx-auto mt-2 max-w-md text-sm text-text-muted">
          {receipt.declined
            ? "Nothing will be collected from you for this project. You can come back to this link if you change your mind."
            : "We have sent you a receipt. You can review or withdraw your consent at any time - withdrawing is as easy as this was."}
        </p>

        <p className="mt-4 text-xs text-text-subtle">
          Your reference: <Mono>{receipt.uuid}</Mono>
        </p>

        <div className="mt-6 flex flex-wrap justify-center gap-3 text-xs">
          <a href="/sign-in" className="text-accent-text underline underline-offset-2">
            Review your consents
          </a>
          <a href="/rights" className="text-accent-text underline underline-offset-2">
            Your rights
          </a>
        </div>
      </CardBody>
    </Card>
  );
}
