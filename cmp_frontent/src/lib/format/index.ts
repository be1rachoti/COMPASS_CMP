import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Merge class names, letting later Tailwind utilities win.
 *
 * Without `twMerge`, `cn("p-2", "p-4")` emits both and the winner depends on
 * stylesheet order rather than call order - which makes a variant prop that is
 * supposed to override a default silently not.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/* -------------------------------------------------------------------- dates */

const DATE_TIME = new Intl.DateTimeFormat("en-IN", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const DATE_ONLY = new Intl.DateTimeFormat("en-IN", {
  day: "2-digit",
  month: "short",
  year: "numeric",
});

/**
 * Absolute timestamps everywhere, in the viewer's locale.
 *
 * This is a compliance record. "3 days ago" is friendlier and useless in an
 * evidence context - somebody reading a consent artefact needs the date it
 * carries, not an approximation of it.
 */
export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "—";
  return DATE_TIME.format(date);
}

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "—";
  return DATE_ONLY.format(date);
}

/** Relative time as a *supplement* to the absolute one, never a replacement. */
export function formatRelative(value: string | Date | null | undefined): string {
  if (!value) return "";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "";

  const seconds = Math.round((date.getTime() - Date.now()) / 1000);
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ["year", 31_536_000],
    ["month", 2_592_000],
    ["day", 86_400],
    ["hour", 3_600],
    ["minute", 60],
  ];
  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) return rtf.format(Math.round(seconds / size), unit);
  }
  return rtf.format(seconds, "second");
}

/**
 * Render a PostgreSQL interval the API returns as ISO-8601 or `n days`.
 *
 * Retention periods are shown to data subjects, so "P3Y" is not an acceptable
 * answer - "3 years" is.
 */
export function formatDuration(value: string | null | undefined): string {
  if (!value) return "—";

  const iso = value.match(/^P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)D)?/);
  if (iso && (iso[1] || iso[2] || iso[3])) {
    const parts: string[] = [];
    if (iso[1]) parts.push(plural(Number(iso[1]), "year"));
    if (iso[2]) parts.push(plural(Number(iso[2]), "month"));
    if (iso[3]) parts.push(plural(Number(iso[3]), "day"));
    return parts.join(", ");
  }

  const days = value.match(/^(\d+)\s*days?$/i);
  if (days) {
    const n = Number(days[1]);
    if (n % 365 === 0) return plural(n / 365, "year");
    if (n % 30 === 0) return plural(n / 30, "month");
    return plural(n, "day");
  }
  return value;
}

function plural(n: number, unit: string): string {
  return `${n} ${unit}${n === 1 ? "" : "s"}`;
}

/* ------------------------------------------------------------------- strings */

/** Turn `under_process` into `Under process` for a label with no mapping. */
export function humanise(value: string | null | undefined): string {
  if (!value) return "—";
  return value.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}

/**
 * Shorten a hash for display while keeping it verifiable by eye.
 *
 * Both ends are kept: a truncation that only shows a prefix can be forged by
 * anyone who can grind a matching prefix.
 */
export function shortHash(hash: string | null | undefined, size = 8): string {
  if (!hash) return "—";
  if (hash.length <= size * 2 + 1) return hash;
  return `${hash.slice(0, size)}…${hash.slice(-size)}`;
}

/** Initials for an avatar, from a full name. */
export function initials(name: string | null | undefined): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/* -------------------------------------------------------------------- files */

/**
 * Hand the browser a downloaded blob.
 *
 * Revoking the object URL matters: without it every download leaks its bytes for
 * the lifetime of the tab, and an operator exporting all day will notice.
 */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const exp = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** exp).toFixed(exp === 0 ? 0 : 1)} ${units[exp]}`;
}

/* ------------------------------------------------------------------- timing */

