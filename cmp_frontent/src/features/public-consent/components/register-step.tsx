/**
 * Step one: who is this.
 *
 * The mobile number is optional and the email is not, because the one-time code
 * goes to the email — asking for a number that will not be used is asking for
 * personal data with no purpose, which is the thing this whole system exists to
 * prevent.
 */
"use client";

import * as React from "react";

import {
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  Field,
  Input,
} from "@/components/ui/primitives";
import { register, requestOtp } from "@/features/public-consent/api";
import { ApiError } from "@/lib/errors";

export function RegisterStep({
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
      await register(token, {
        full_name: form.full_name,
        email: form.email,
        mobile: form.mobile || undefined,
        person_type: "external",
      });
      await requestOtp(token, form.email);
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
        <form method="post" onSubmit={submit} className="space-y-4" noValidate>
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
