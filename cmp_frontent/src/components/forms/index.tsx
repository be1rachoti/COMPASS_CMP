/**
 * Form plumbing shared by every create and edit screen.
 *
 * The piece that earns its keep is `useApiForm`. The API returns field-level
 * errors in a documented shape:
 *
 *     {"error": {"code", "message", "field", "errors": [{field, message}]}}
 *
 * and this maps them straight onto the form's fields. Without it every form
 * shows one banner saying "validation failed" and leaves the user to work out
 * which of eleven inputs was wrong - which is how people end up guessing, and
 * how a required field that the client did not know about becomes unfillable.
 *
 * Server validation is the authority. The client-side zod schema exists to give
 * fast feedback, not to be the rule: the API validates independently and its
 * answer wins.
 */
"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import * as React from "react";
import {
  useForm,
  type DefaultValues,
  type FieldValues,
  type Path,
  type UseFormReturn,
} from "react-hook-form";
import type { ZodType, ZodTypeDef } from "zod";

import { Alert } from "@/components/ui/primitives";
import { ApiError } from "@/lib/errors";
import { formatBytes } from "@/lib/format";

export interface ApiFormResult<TOut extends FieldValues, TIn extends FieldValues = TOut>
  extends UseFormReturn<TIn, unknown, TOut> {
  /** Error that belongs to the form as a whole, not to one field. */
  formError: string | null;
  setFormError: (message: string | null) => void;
  /** Wraps a submit handler: maps ApiError onto fields, everything else to the banner. */
  submit: (
    handler: (values: TOut) => Promise<void>,
  ) => (event?: React.BaseSyntheticEvent) => void;
}

/**
 * `TIn` is separate from `T` on purpose.
 *
 * A schema's *input* is what the fields hold while somebody is typing — an
 * empty text box is `""` — and its *output* is what the API receives, where
 * that same field is `null`. The `optional()` primitive is exactly this
 * transform. Collapsing the two would force every optional field to be typed as
 * if a blank box were already `null`, which is only true after parsing.
 */
export function useApiForm<TOut extends FieldValues, TIn extends FieldValues>(
  schema: ZodType<TOut, ZodTypeDef, TIn>,
  defaults: DefaultValues<TIn>,
): ApiFormResult<TOut, TIn> {
  const [formError, setFormError] = React.useState<string | null>(null);

  const form = useForm<TIn, unknown, TOut>({
    resolver: zodResolver(schema),
    defaultValues: defaults,
    // Validate on blur rather than on every keystroke: an error appearing under
    // a field the user is still typing into reads as the app arguing with them.
    mode: "onBlur",
  });

  const submit = React.useCallback(
    (handler: (values: TOut) => Promise<void>) =>
      form.handleSubmit(async (values) => {
        setFormError(null);
        try {
          await handler(values);
        } catch (error) {
          if (!(error instanceof ApiError)) {
            setFormError("Could not reach the server. Check your connection and try again.");
            return;
          }

          const fields = error.fieldErrors();
          let matched = 0;
          for (const [name, message] of Object.entries(fields)) {
            // Only set errors for fields this form actually has; a server field
            // we do not render must surface in the banner or it is invisible.
            if (name in form.getValues()) {
              form.setError(name as Path<TIn>, { message });
              matched += 1;
            }
          }

          if (matched === 0) {
            setFormError(
              error.isRateLimited
                ? `${error.userMessage()} Try again in about ${Math.ceil(
                    (error.retryAfterSeconds ?? 60) / 60,
                  )} minutes.`
                : error.userMessage(),
            );
          } else if (Object.keys(fields).length > matched) {
            // Some errors landed on fields, some did not. Say so rather than
            // silently dropping the ones with nowhere to go.
            setFormError(error.userMessage());
          }
        }
      }),
    [form],
  );

  return { ...form, formError, setFormError, submit };
}

/** Banner for whole-form errors. Rendered above the fields, where it is read first. */
export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <Alert tone="danger" className="mb-4">
      {message}
    </Alert>
  );
}

/**
 * Multi-select for a controlled vocabulary, as checkboxes.
 *
 * Used for `data_categories`, which Rule 3(b)(i) requires to be itemised. A free
 * text field here would produce "phone", "Phone no" and "mobile number" as three
 * different categories, and a rights request would have to match all three.
 */
export function CheckboxGroup({
  label,
  hint,
  error,
  options,
  value,
  onChange,
  columns = 2,
}: {
  label: string;
  hint?: string;
  error?: string;
  options: Array<{ value: string; label: string; group?: string }>;
  value: string[];
  onChange: (next: string[]) => void;
  columns?: number;
}) {
  const id = React.useId();
  const grouped = React.useMemo(() => {
    const map = new Map<string, typeof options>();
    for (const option of options) {
      const key = option.group ?? "";
      map.set(key, [...(map.get(key) ?? []), option]);
    }
    return [...map.entries()];
  }, [options]);

  function toggle(v: string) {
    onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);
  }

  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium text-text">{label}</legend>
      {hint && <p className="text-xs text-text-subtle">{hint}</p>}

      <div className="space-y-3 rounded-md border border-border-strong p-3">
        {grouped.map(([group, items]) => (
          <div key={group}>
            {group && (
              <p className="mb-1.5 text-2xs font-semibold uppercase tracking-wide text-text-subtle">
                {group}
              </p>
            )}
            <div
              className="grid gap-x-4 gap-y-1.5"
              style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
            >
              {items.map((option) => (
                <label
                  key={option.value}
                  className="flex cursor-pointer items-center gap-2 text-sm"
                >
                  <input
                    type="checkbox"
                    className="size-4 rounded border-border-strong accent-[var(--accent)]"
                    checked={value.includes(option.value)}
                    onChange={() => toggle(option.value)}
                    aria-describedby={error ? `${id}-error` : undefined}
                  />
                  <span>{option.label}</span>
                </label>
              ))}
            </div>
          </div>
        ))}
      </div>

      {error && (
        <p id={`${id}-error`} role="alert" className="text-xs text-danger-text">
          {error}
        </p>
      )}
      {value.length > 0 && (
        <p className="text-xs text-text-subtle">{value.length} selected</p>
      )}
    </fieldset>
  );
}

/**
 * File input for the two upload paths: approval proof and import manifest.
 *
 * Shows the selected name and size, because a 25 MB cap that is only discovered
 * on submit wastes the whole upload.
 */
export function FileInput({
  label,
  hint,
  error,
  accept,
  maxBytes,
  file,
  onChange,
  required,
}: {
  label: string;
  hint?: string;
  error?: string;
  accept?: string;
  maxBytes?: number;
  file: File | null;
  onChange: (file: File | null) => void;
  required?: boolean;
}) {
  const id = React.useId();
  const [localError, setLocalError] = React.useState<string | null>(null);

  function pick(next: File | null) {
    setLocalError(null);
    if (next && maxBytes && next.size > maxBytes) {
      setLocalError(
        `That file is ${formatBytes(next.size)}. The limit is ${formatBytes(maxBytes)}.`,
      );
      onChange(null);
      return;
    }
    onChange(next);
  }

  const shown = error ?? localError;

  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium text-text">
        {label}
        {required && (
          <span className="ml-0.5 text-danger" aria-label="required">
            *
          </span>
        )}
      </label>

      <input
        id={id}
        type="file"
        accept={accept}
        onChange={(e) => pick(e.target.files?.[0] ?? null)}
        aria-invalid={shown ? true : undefined}
        aria-describedby={shown ? `${id}-error` : hint ? `${id}-hint` : undefined}
        className={[
          "block w-full text-sm text-text-muted",
          "file:mr-3 file:rounded-md file:border-0 file:bg-accent file:px-3 file:py-1.5",
          "file:text-sm file:font-medium file:text-white hover:file:bg-accent-hover",
          "file:cursor-pointer",
        ].join(" ")}
      />

      {file && (
        <p className="text-xs text-text-muted">
          {file.name} · {formatBytes(file.size)}
        </p>
      )}

      {shown ? (
        <p id={`${id}-error`} role="alert" className="text-xs text-danger-text">
          {shown}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-xs text-text-subtle">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
