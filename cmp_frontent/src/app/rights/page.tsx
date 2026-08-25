/**
 * Rights information — public, no authentication.
 *
 * Rule 9 and Rule 14(1). Published so someone who has lost their notice can
 * still find out what they are entitled to and how to ask for it.
 *
 * The Board complaint route is stated alongside the internal one, not instead of
 * it. Telling someone only about the grievance process misstates the remedy
 * available to them.
 */
"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { BrandMark, SignalField } from "@/components/ui/graphics";
import { Alert, Card, CardBody, CardHeader, CardTitle, Skeleton } from "@/components/ui/primitives";
import { apiGet } from "@/lib/api-client";

interface RightsPayload {
  dpo_contact: string;
  how_to_exercise: Array<{ right: string; section: string; description: string }>;
  withdraw_consent: string;
  response_time: string;
  board_complaint: string;
}

export default function RightsPage() {
  const [data, setData] = React.useState<RightsPayload | null>(null);
  const [failed, setFailed] = React.useState(false);

  React.useEffect(() => {
    apiGet<RightsPayload>("/rights")
      .then(setData)
      .catch(() => setFailed(true));
  }, []);

  return (
    <div className="min-h-dvh bg-bg-subtle">
      <header className="brand-gradient relative overflow-hidden">
        <SignalField className="absolute -right-24 -top-32 h-96 w-96 text-white/35" />
        <div className="relative mx-auto max-w-2xl px-4 py-10 sm:py-14">
          <span className="grid size-11 place-items-center rounded-xl bg-white/15 ring-1 ring-white/25">
            <BrandMark className="size-6 text-white" />
          </span>
          <h1 className="mt-4 text-3xl font-semibold tracking-tight text-white">
            Your rights
          </h1>
          <p className="mt-3 max-w-xl text-sm leading-relaxed text-white/80">
            Under the Digital Personal Data Protection Act 2023, you have rights over
            the personal data we hold about you. This page explains what they are and
            how to use them.
          </p>
        </div>
      </header>

      <main id="main" className="mx-auto max-w-2xl px-4 py-8 sm:py-10">
      {failed && (
        <Alert tone="warning" className="mb-6">
          We could not load our current contact details. The rights below still
          apply; please try again shortly.
        </Alert>
      )}

      {!data && !failed && <Skeleton className="h-96" />}

      {data && (
        <div className="space-y-5">
          <Card>
            <CardHeader>
              <CardTitle>What you can ask for</CardTitle>
            </CardHeader>
            <CardBody>
              <dl className="space-y-5">
                {data.how_to_exercise.map((item) => (
                  <div key={item.right}>
                    <dt className="flex flex-wrap items-baseline gap-2">
                      <span className="text-sm font-semibold">{item.right}</span>
                      <span className="rounded-full border border-border bg-bg-inset px-2 py-0.5 text-2xs text-text-subtle">
                        {item.section}
                      </span>
                    </dt>
                    <dd className="mt-1 text-sm leading-relaxed text-text-muted">
                      {item.description}
                    </dd>
                  </div>
                ))}
              </dl>
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Withdrawing your consent</CardTitle>
            </CardHeader>
            <CardBody className="space-y-3">
              <p className="text-sm leading-relaxed text-text-muted">
                {data.withdraw_consent}
              </p>
              <Link
                href="/sign-in"
                className="inline-block text-sm text-accent-text underline underline-offset-2"
              >
                Sign in to review or withdraw your consents
              </Link>
              <p className="text-xs text-text-subtle">
                Withdrawing stops future processing for the purposes you withdraw.
                It does not by itself delete data already collected — ask for
                erasure if that is what you want.
              </p>
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Contacting us</CardTitle>
            </CardHeader>
            <CardBody className="space-y-2">
              <p className="text-sm">
                <span className="text-text-muted">Data Protection Officer: </span>
                <a
                  href={`mailto:${data.dpo_contact}`}
                  className="text-accent-text underline underline-offset-2"
                >
                  {data.dpo_contact}
                </a>
              </p>
              <p className="text-sm text-text-muted">{data.response_time}</p>
            </CardBody>
          </Card>

          <Alert tone="info" title="If you are not satisfied">
            <p className="leading-relaxed">{data.board_complaint}</p>
          </Alert>
        </div>
      )}

      <p className="mt-8 text-center text-xs">
        <Link
          href="/sign-in"
          className="inline-flex items-center gap-1 text-text-subtle underline underline-offset-2 hover:text-text-muted"
        >
          <ArrowLeft className="size-3.5" aria-hidden="true" />
          Back to sign in
        </Link>
      </p>
      </main>
    </div>
  );
}
