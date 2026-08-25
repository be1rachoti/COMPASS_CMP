/**
 * The public consent flow.
 *
 * This is the only screen a data principal is *required* to use, and the one
 * that has to be right. Four steps: validate the link, register, confirm the
 * contact, read the notice and choose.
 *
 * This file holds the state machine and nothing else — which step is current,
 * what the link resolved to, which notice was served. Each step owns its own
 * form state, its own submission and its own error handling, and reports back
 * through a callback. That division is what keeps the flow's *shape* legible:
 * everything below is the sequence a person walks, in order.
 *
 * The decisions that are not cosmetic live with the steps that implement them,
 * except for the one this file owns:
 *
 * **An invalid link renders no notice content and does not say why.** Expired,
 * revoked, exhausted and mistyped all land in the same place. Naming the reason
 * would tell somebody guessing tokens which of their guesses was structurally
 * valid, and the page offers every possibility at once instead — which helps a
 * legitimate visitor and tells an attacker nothing.
 */
"use client";

import { AlertCircle } from "lucide-react";
import { useParams } from "next/navigation";
import * as React from "react";

import { Alert, Card, CardBody, Skeleton } from "@/components/ui/primitives";
import { getLink, serveNotice } from "@/features/public-consent/api";
import {
  DoneStep,
  NoticeStep,
  RegisterStep,
  Shell,
  Steps,
  VerifyStep,
  type Step,
} from "@/features/public-consent/components";
import { ApiError } from "@/lib/errors";
import type { LanguageCode, LinkView, ServedNotice } from "@/types";

export default function ConsentPage() {
  const { token } = useParams<{ token: string }>();

  const [step, setStep] = React.useState<Step>("loading");
  const [link, setLink] = React.useState<LinkView | null>(null);
  const [contact, setContact] = React.useState("");
  const [language, setLanguage] = React.useState<LanguageCode>("english");
  const [notice, setNotice] = React.useState<ServedNotice | null>(null);
  const [receipt, setReceipt] = React.useState<{ uuid: string; declined: boolean } | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    getLink(token)
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

  /**
   * Serve the notice in a language, and record which one was served.
   *
   * Called on entry to the notice step and again on every language change —
   * and the second is not a wasted request. Re-serving stamps a fresh
   * `served_at`, because she is now reading a different rendition and the
   * evidence has to say which one she was shown.
   */
  const serve = React.useCallback(
    async (next: LanguageCode) => {
      const served = await serveNotice(token, next);
      setNotice(served);
      setLanguage(next);
    },
    [token],
  );

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

  if (step === "invalid") {
    return (
      <Shell>
        <Card>
          <CardBody className="py-10 text-center">
            <AlertCircle className="mx-auto size-8 text-text-subtle" aria-hidden="true" />
            <h1 className="mt-4 text-lg font-semibold">This link is not valid</h1>
            <p className="mx-auto mt-2 max-w-sm text-sm text-text-muted">
              It may have expired, been withdrawn, or been mistyped. Please ask the person who
              gave it to you for a current one.
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
              await serve(language);
              setStep("notice");
            } catch (err) {
              setError(err instanceof ApiError ? err.userMessage() : "Could not load the notice.");
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
            try {
              await serve(next);
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
