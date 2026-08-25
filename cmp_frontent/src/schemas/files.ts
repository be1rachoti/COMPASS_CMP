/**
 * Upload validation.
 *
 * Two upload paths exist — an approval proof and an import manifest — and both
 * are the input this system trusts least: one arrives from a researcher's
 * laptop, the other from a third-party capture tool.
 *
 * The client checks are a courtesy. **The server checks again and is the only
 * authority**: it re-reads the declared size against the actual bytes, sniffs
 * the content type rather than believing the browser's, and rewrites the
 * suffix. What this buys is somebody finding out their 60 MB scan is too large
 * before uploading it over a hotel connection.
 *
 * Order matters, here as on the server: refuse on size before reading, refuse
 * on type before parsing. Each step is cheaper than the one it protects.
 *
 * Mirrors `cmp.validation.files`.
 */

import { z } from "zod";

/** What one upload slot accepts. Mirrors the server's `UploadRules`. */
export interface UploadRules {
  readonly field: string;
  readonly maxBytes: number;
  readonly allowedMime: readonly string[];
  /**
   * Extensions kept on the stored file. Anything else becomes `.bin` on the
   * server, so a `.php` or `.exe` cannot be written to disk under its own name
   * whatever the client called it.
   */
  readonly allowedSuffixes: readonly string[];
  /** What to call this in a message. "an approval document", not "proof". */
  readonly describedAs: string;
}

export const PROOF: UploadRules = {
  field: "proof",
  maxBytes: 25 * 1024 * 1024,
  allowedMime: ["application/pdf", "image/png", "image/jpeg"],
  allowedSuffixes: [".pdf", ".png", ".jpg", ".jpeg"],
  describedAs: "an approval document",
};

export const MANIFEST: UploadRules = {
  field: "manifest",
  maxBytes: 25 * 1024 * 1024,
  allowedMime: ["text/csv", "application/csv", "text/plain"],
  allowedSuffixes: [".csv", ".txt"],
  describedAs: "a manifest",
};

/** "25 MB", for a message somebody has to read while annoyed. */
export function describeSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${Math.round(bytes / (1024 * 1024))} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}

function suffixOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot).toLowerCase();
}

/**
 * A file input constrained to one slot's rules.
 *
 * Checks the suffix as well as the reported MIME type, because browsers
 * disagree about CSV: Chrome sends `text/csv`, Windows Excel installs make it
 * `application/vnd.ms-excel`, and some send nothing at all. Refusing on MIME
 * alone would reject a perfectly good manifest depending on what the user has
 * installed, which is not a rule anybody can act on.
 */
export function fileSchema(rules: UploadRules) {
  return z
    .instanceof(File, { message: `Choose ${rules.describedAs}` })
    .refine((file) => file.size > 0, "That file is empty")
    .refine(
      (file) => file.size <= rules.maxBytes,
      `Files have to be under ${describeSize(rules.maxBytes)}`,
    )
    .refine(
      (file) =>
        rules.allowedMime.includes(file.type) ||
        rules.allowedSuffixes.includes(suffixOf(file.name)),
      `Accepted formats: ${rules.allowedSuffixes.join(", ")}`,
    );
}
