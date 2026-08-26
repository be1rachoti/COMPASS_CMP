/**
 * Password reset.
 *
 * This page existed as a link before it existed as a page: sign-in offered
 * "Forgotten your password?" pointing at a route that 404'd, and Next's
 * prefetch made that 404 fire on every visit to sign-in. The API had both
 * endpoints all along.
 *
 * Two steps in one screen, because they are one task and the code arrives in
 * seconds. Splitting them across routes would lose the address the person
 * already typed, and asking for it twice is asking somebody who has just
 * forgotten one thing to remember another.
 *
 * The security property that shapes the copy: **the server answers identically
 * whether the address is registered or not.** So the confirmation says "if that
 * address is registered" rather than "check your email" — the second would
 * confirm an account exists to anybody who types an address in, which is an
 * account-enumeration oracle with a friendly face.
 */
"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeft, MailCheck } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import { useForm } from "react-hook-form";

import { AuthLayout } from "@/components/layout/auth-layout";
import { Alert, Button, Field, Input } from "@/components/ui/primitives";
import {
  confirmPasswordReset,
  requestPasswordReset,
  resetConfirmSchema,
  resetRequestSchema,
  type ResetConfirmValues,
  type ResetRequestValues,
} from "@/features/auth";
import { ApiError } from "@/lib/errors";
import { useHydrated } from "@/lib/security";

export default function ResetPage() {
  const [sentTo, setSentTo] = React.useState<string | null>(null);

  return (
    <AuthLayout
      title={sentTo ? "Check your email" : "Reset your password"}
      subtitle={
        sentTo
          ? `If ${sentTo} is registered, a six-digit code is on its way. It is valid for a few minutes.`
          : "We will send a code to your registered email address."
      }
      footer={
        <Link
          href="/sign-in"
          className="inline-flex items-center gap-1.5 underline underline-offset-2 hover:text-text-muted"
        >
          <ArrowLeft className="size-3.5" aria-hidden="true" />
          Back to sign in
        </Link>
      }
    >
      {sentTo ? (
        <ConfirmStep email={sentTo} onStartOver={() => setSentTo(null)} />
      ) : (
        <RequestStep onSent={setSentTo} />
      )}
    </AuthLayout>
  );
}

function RequestStep({ onSent }: { onSent: (email: string) => void }) {
  const hydrated = useHydrated();
  const [error, setError] = React.useState<string | null>(null);

  const form = useForm<ResetRequestValues>({
    resolver: zodResolver(resetRequestSchema),
    defaultValues: { email: "" },
    mode: "onBlur",
  });

  const submit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      await requestPasswordReset(values);
      onSent(values.email);
    } catch (err) {
      // A rate limit is the one failure worth naming: the person has asked
      // several times and needs to know that waiting is the answer, not that
      // their address is wrong.
      setError(
        err instanceof ApiError
          ? err.userMessage()
          : "Could not reach the server. Check your connection and try again.",
      );
    }
  });

  return (
    <form method="post" onSubmit={submit} className="space-y-4" noValidate>
      {error && <Alert tone="danger">{error}</Alert>}

      <Field
        label="Email address"
        error={form.formState.errors.email?.message}
        required
        hint="The address your account was created with."
      >
        {(p) => (
          <Input
            {...p}
            {...form.register("email")}
            type="email"
            autoComplete="email"
            autoFocus
            placeholder="you@organisation.example"
          />
        )}
      </Field>

      <Button
        type="submit"
        variant="primary"
        className="w-full"
        loading={form.formState.isSubmitting}
        disabled={!hydrated}
      >
        Send the code
      </Button>
    </form>
  );
}

function ConfirmStep({ email, onStartOver }: { email: string; onStartOver: () => void }) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [error, setError] = React.useState<string | null>(null);
  const [done, setDone] = React.useState(false);

  const form = useForm<ResetConfirmValues>({
    resolver: zodResolver(resetConfirmSchema),
    defaultValues: { email, code: "", new_password: "", confirm_password: "" },
    mode: "onBlur",
  });

  const submit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      await confirmPasswordReset({
        email: values.email,
        code: values.code,
        new_password: values.new_password,
      });
      setDone(true);
      // Long enough to read the confirmation, short enough not to feel stuck.
      setTimeout(() => router.replace("/sign-in"), 2500);
    } catch (err) {
      if (err instanceof ApiError) {
        const fields = err.fieldErrors();
        for (const [name, message] of Object.entries(fields)) {
          if (name === "code" || name === "new_password" || name === "email") {
            form.setError(name as keyof ResetConfirmValues, { message });
          }
        }
        if (Object.keys(fields).length === 0) setError(err.userMessage());
      } else {
        setError("Could not reach the server. Check your connection and try again.");
      }
    }
  });

  if (done) {
    return (
      <Alert tone="success" title="Password changed">
        <span className="inline-flex items-center gap-2">
          <MailCheck className="size-4" aria-hidden="true" />
          Every other session has been signed out. Taking you to sign in…
        </span>
      </Alert>
    );
  }

  return (
    <form method="post" onSubmit={submit} className="space-y-4" noValidate>
      {error && <Alert tone="danger">{error}</Alert>}

      <Field label="Code" error={form.formState.errors.code?.message} required>
        {(p) => (
          <Input
            {...p}
            {...form.register("code")}
            // `one-time-code` lets a phone offer the code from the message, and
            // `inputMode` opens the numeric keypad. Both are small and both are
            // the difference between typing six digits and hunting for them.
            autoComplete="one-time-code"
            inputMode="numeric"
            maxLength={10}
            autoFocus
            placeholder="123456"
          />
        )}
      </Field>

      <Field
        label="New password"
        error={form.formState.errors.new_password?.message}
        required
        hint="At least 12 characters. A phrase you can remember beats a short jumble."
      >
        {(p) => (
          <Input
            {...p}
            {...form.register("new_password")}
            type="password"
            autoComplete="new-password"
          />
        )}
      </Field>

      <Field
        label="Confirm new password"
        error={form.formState.errors.confirm_password?.message}
        required
      >
        {(p) => (
          <Input
            {...p}
            {...form.register("confirm_password")}
            type="password"
            autoComplete="new-password"
          />
        )}
      </Field>

      <Button
        type="submit"
        variant="primary"
        className="w-full"
        loading={form.formState.isSubmitting}
        disabled={!hydrated}
      >
        Set the new password
      </Button>

      <p className="text-center text-xs text-text-subtle">
        <button
          type="button"
          onClick={onStartOver}
          className="underline underline-offset-2 hover:text-text-muted"
        >
          Use a different address
        </button>
      </p>
    </form>
  );
}
