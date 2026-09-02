/**
 * Sign-up — for a data principal, and nobody else.
 *
 * Staff accounts are created by an administrator, so there is no role to choose
 * here and no field that could carry one. The server writes `data_subject`
 * itself; this page could not create anything else even if it tried.
 *
 * **Date of birth is required, and it is not a profile decoration.** Section 9
 * of the DPDP Act treats a person under eighteen as a child and requires
 * verifiable consent from a parent or guardian. Registration is the one moment
 * the platform can ask, so it asks — and the form says why, because a birth date
 * demanded without explanation reads as data collection for its own sake, on a
 * page whose whole subject is informed consent.
 *
 * The success state is deliberately vague about whether the address was new.
 * The server answers identically either way, and a friendlier message here —
 * "welcome!" versus "you already have an account" — would undo that and turn the
 * form into a way to test who is on a consent register.
 */
"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { CheckCircle2, UserPlus } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { AuthLayout } from "@/components/layout/auth-layout";
import { Alert, Button, Field, Input } from "@/components/ui/primitives";
import { register as registerAccount } from "@/features/auth";
import { ApiError } from "@/lib/errors";

/** Matches the server's CHECK: in the past, and this side of 1900. */
const EARLIEST = "1900-01-01";

const schema = z.object({
  full_name: z.string().min(2, "Enter your full name").max(120),
  email: z.string().email("Enter a valid email address"),
  dob: z
    .string()
    .min(1, "Enter your date of birth")
    .refine((v) => v > EARLIEST, "Enter a valid date of birth")
    .refine(
      (v) => v < new Date().toISOString().slice(0, 10),
      "Date of birth must be in the past",
    ),
  mobile: z.string().max(20).optional().or(z.literal("")),
});

type Values = z.infer<typeof schema>;

export default function SignUpPage() {
  const [sent, setSent] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { full_name: "", email: "", dob: "", mobile: "" },
  });

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      await registerAccount({
        full_name: values.full_name,
        email: values.email,
        dob: values.dob,
        mobile: values.mobile ? values.mobile : null,
      });
      setSent(values.email);
    } catch (caught) {
      // Rate limiting is the one failure worth naming: it is the only one the
      // person can act on, by waiting. Everything else stays generic so the form
      // reveals nothing about which addresses exist.
      setError(
        caught instanceof ApiError && caught.status === 429
          ? caught.userMessage()
          : "We could not complete that. Please try again.",
      );
    }
  });

  if (sent) {
    return (
      <AuthLayout
        title="Check your email"
        subtitle="We have sent a sign-in code, if that address can receive one."
      >
        <Alert tone="success">
          <CheckCircle2 className="size-4" aria-hidden="true" />
          <span>
            A code is on its way to <strong>{sent}</strong>. Enter it on the sign-in page to
            finish.
          </span>
        </Alert>
        <Button asChild variant="primary" className="mt-4 w-full">
          <Link href={`/sign-in?contact=${encodeURIComponent(sent)}`}>Enter the code</Link>
        </Button>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Create your account"
      subtitle="For people whose data is being collected. Staff accounts are issued by your administrator."
      footer={
        <p className="text-center text-sm text-text-muted">
          Already registered?{" "}
          <Link href="/sign-in" className="font-medium text-accent-text hover:underline">
            Sign in
          </Link>
        </p>
      }
    >
      <form method="post" onSubmit={onSubmit} noValidate className="space-y-4">
        {error && <Alert tone="danger">{error}</Alert>}

        <Field label="Full name" error={form.formState.errors.full_name?.message} required>
          {(p) => <Input {...p} {...form.register("full_name")} autoComplete="name" />}
        </Field>

        <Field label="Email address" error={form.formState.errors.email?.message} required>
          {(p) => (
            <Input {...p} {...form.register("email")} type="email" autoComplete="email" />
          )}
        </Field>

        <Field
          label="Date of birth"
          hint="The law treats people under 18 differently: consent for a child has to come from a parent or guardian. We ask so we can apply the right rule to you."
          error={form.formState.errors.dob?.message}
          required
        >
          {(p) => (
            <Input
              {...p}
              {...form.register("dob")}
              type="date"
              max={new Date().toISOString().slice(0, 10)}
              min={EARLIEST}
              autoComplete="bday"
            />
          )}
        </Field>

        <Field
          label="Mobile"
          hint="Optional. Used only to reach you about your own consents."
          error={form.formState.errors.mobile?.message}
        >
          {(p) => <Input {...p} {...form.register("mobile")} type="tel" autoComplete="tel" />}
        </Field>

        <Button
          type="submit"
          variant="primary"
          className="w-full"
          loading={form.formState.isSubmitting}
        >
          <UserPlus className="size-4" />
          Create account
        </Button>
      </form>
    </AuthLayout>
  );
}
