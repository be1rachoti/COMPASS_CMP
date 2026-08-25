/**
 * Step four: the receipt.
 *
 * Shows the consent reference because the person may need to quote it, and
 * treats a decline as a completed outcome rather than a failure — refusing is a
 * valid answer, and a screen that reads like an error after one teaches people
 * that refusing was a mistake.
 */
"use client";

import { Check, X } from "lucide-react";

import { Card, CardBody, Mono } from "@/components/ui/primitives";

export function DoneStep({ receipt }: { receipt: { uuid: string; declined: boolean } }) {
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
