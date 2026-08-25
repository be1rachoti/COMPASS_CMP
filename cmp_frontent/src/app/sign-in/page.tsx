/**
 * Staff sign-in.
 *
 * Two flows behind one form:
 *
 * - Password. Where MFA applies (DPO, admin), the response says `mfa_required`
 *   and we move to the verification step; the partial session the server issued
 *   authorises nothing else.
 * - Data subject. No password exists - `password_hash` is nullable for exactly
 *   this reason - so they receive a one-time code instead.
 *
 * Every failure message is identical by design. The server refuses to say
 * whether an account exists, and repeating a friendlier message here would undo
 * that.
 */
"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { KeyRound, Mail } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import * as React from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { AuthLayout } from "@/components/layout/auth-layout";
import { Alert, Button, Field, Input } from "@/components/ui/primitives";
import { requestOtp, signInWithPassword, verifyOtp } from "@/features/auth";
import { ApiError } from "@/lib/errors";
import { safeRedirectPath } from "@/lib/security";
import { useAuth } from "@/providers";

const passwordSchema = z.object({
  login: z.string().min(3, "Enter your email address or username"),
  password: z.string().min(1, "Enter your password"),
});

const otpRequestSchema = z.object({
  contact: z.string().min(3, "Enter the email address or mobile you registered"),
});

type PasswordForm = z.infer<typeof passwordSchema>;
type OtpRequestForm = z.infer<typeof otpRequestSchema>;

export default function SignInPage() {
  const [mode, setMode] = React.useState<"staff" | "subject">("staff");

  return (
    <AuthLayout
      title="Sign in"
      subtitle="Staff sign in with a password. If you consented to a project, choose
        “Data subject” and we will send you a one-time code instead."
      footer={
        <p className="text-center text-xs text-text-subtle">
          <Link href="/rights" className="underline underline-offset-2 hover:text-text-muted">
            Your rights and how to exercise them
          </Link>
        </p>
      }
    >
      <div
        role="tablist"
        aria-label="Sign-in method"
        className="mb-6 grid grid-cols-2 gap-1 rounded-xl border border-border bg-bg-inset p-1"
      >
        <TabButton
          selected={mode === "staff"}
          onClick={() => setMode("staff")}
          controls="staff-panel"
          icon={<KeyRound className="size-3.5" aria-hidden="true" />}
        >
          Staff
        </TabButton>
        <TabButton
          selected={mode === "subject"}
          onClick={() => setMode("subject")}
          controls="subject-panel"
          icon={<Mail className="size-3.5" aria-hidden="true" />}
        >
          Data subject
        </TabButton>
      </div>

      {/* useSearchParams() forces client-side rendering, so Next requires a
          suspense boundary around anything that reads it. Without this the
          whole page bails out of prerendering. */}
      {mode === "staff" ? (
        <React.Suspense fallback={<FormSkeleton />}>
          <StaffForm />
        </React.Suspense>
      ) : (
        <SubjectForm />
      )}
    </AuthLayout>
  );
}

function FormSkeleton() {
  return (
    <div className="space-y-4" aria-hidden="true">
      <div className="shimmer h-16 rounded-lg" />
      <div className="shimmer h-16 rounded-lg" />
      <div className="shimmer h-10 rounded-lg" />
    </div>
  );
}

function TabButton({
  selected,
  onClick,
  controls,
  icon,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  controls: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      aria-controls={controls}
      onClick={onClick}
      className={[
        "flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium",
        "transition-[background-color,color,box-shadow] duration-150",
        selected
          ? "bg-surface text-text shadow-[var(--shadow-sm)]"
          : "text-text-muted hover:text-text",
      ].join(" ")}
    >
      {icon}
      {children}
    </button>
  );
}

function StaffForm() {
  const router = useRouter();
  const params = useSearchParams();
  const { refresh } = useAuth();
  const [formError, setFormError] = React.useState<string | null>(null);

  const form = useForm<PasswordForm>({
    resolver: zodResolver(passwordSchema),
    defaultValues: { login: "", password: "" },
  });

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    try {
      const result = await signInWithPassword(values);

      if (result.mfa_required) {
        // The partial session is already set as a cookie. The verify screen is
        // the only thing it unlocks.
        router.push("/sign-in/verify");
        return;
      }

      await refresh();
      // `next` is attacker-controlled - it is whatever was in the link that
      // sent them here. Anything not a same-origin path becomes the dashboard.
      router.replace(safeRedirectPath(params.get("next"), "/dashboard"));
    } catch (error) {
      if (error instanceof ApiError) {
        // Field errors go on the field; everything else goes in the banner.
        const fields = error.fieldErrors();
        for (const [name, message] of Object.entries(fields)) {
          if (name === "login" || name === "password") {
            form.setError(name, { message });
          }
        }
        if (!Object.keys(fields).length) {
          setFormError(
            error.isRateLimited
              ? `${error.userMessage()} Try again in about ${Math.ceil(
                  (error.retryAfterSeconds ?? 60) / 60,
                )} minutes.`
              : error.userMessage(),
          );
        }
      } else {
        setFormError("Could not reach the server. Check your connection.");
      }
    }
  });

  return (
    <form id="staff-panel" role="tabpanel" onSubmit={onSubmit} className="space-y-4" noValidate>
      {formError && <Alert tone="danger">{formError}</Alert>}

      <Field label="Email or username" error={form.formState.errors.login?.message} required>
        {(props) => (
          <Input
            {...props}
            {...form.register("login")}
            type="text"
            autoComplete="username"
            autoFocus
            placeholder="you@organisation.example"
          />
        )}
      </Field>

      <Field label="Password" error={form.formState.errors.password?.message} required>
        {(props) => (
          <Input
            {...props}
            {...form.register("password")}
            type="password"
            autoComplete="current-password"
          />
        )}
      </Field>

      <Button type="submit" variant="primary" className="w-full" loading={form.formState.isSubmitting}>
        Sign in
      </Button>

      <p className="text-center text-xs text-text-subtle">
        <Link
          href="/sign-in/reset"
          className="underline underline-offset-2 hover:text-text-muted"
        >
          Forgotten your password?
        </Link>
      </p>
    </form>
  );
}

function SubjectForm() {
  const [sent, setSent] = React.useState(false);
  const [contact, setContact] = React.useState("");

  const form = useForm<OtpRequestForm>({
    resolver: zodResolver(otpRequestSchema),
    defaultValues: { contact: "" },
  });

  const onSubmit = form.handleSubmit(async (values) => {
    // Deliberately ignores the outcome: the endpoint answers identically whether
    // or not the contact is registered, so that this form cannot be used to
    // discover who consented to a project.
    try {
      await requestOtp(values);
    } catch {
      // Even a failure must not distinguish. A network error still shows the
      // same screen; the code simply will not arrive.
    }
    setContact(values.contact);
    setSent(true);
  });

  if (sent) {
    return (
      <div id="subject-panel" role="tabpanel" className="space-y-4">
        <Alert tone="info" title="Check your messages">
          If <strong>{contact}</strong> is registered with us, a six-digit code is
          on its way. It expires in ten minutes.
        </Alert>
        <SubjectVerifyForm contact={contact} />
        <Button variant="ghost" className="w-full" onClick={() => setSent(false)}>
          Use a different contact
        </Button>
      </div>
    );
  }

  return (
    <form id="subject-panel" role="tabpanel" onSubmit={onSubmit} className="space-y-4" noValidate>
      <Field
        label="Email or mobile"
        hint="The one you gave when you consented. We will send a one-time code."
        error={form.formState.errors.contact?.message}
        required
      >
        {(props) => (
          <Input
            {...props}
            {...form.register("contact")}
            type="text"
            autoComplete="email"
            placeholder="you@example.org"
          />
        )}
      </Field>

      <Button type="submit" variant="primary" className="w-full" loading={form.formState.isSubmitting}>
        Send me a code
      </Button>
    </form>
  );
}

function SubjectVerifyForm({ contact }: { contact: string }) {
  const router = useRouter();
  const { refresh } = useAuth();
  const [code, setCode] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await verifyOtp({ contact, code });
      await refresh();
      router.replace("/my-consents");
    } catch (err) {
      setError(err instanceof ApiError ? err.userMessage() : "Verification failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      {error && <Alert tone="danger">{error}</Alert>}
      <Field label="Six-digit code" required>
        {(props) => (
          <Input
            {...props}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="000000"
            className="h-14 text-center font-mono text-2xl tracking-[0.5em] indent-[0.5em]"
            autoFocus
          />
        )}
      </Field>
      <Button type="submit" variant="primary" className="w-full" loading={busy} disabled={code.length !== 6}>
        Verify
      </Button>
    </form>
  );
}
