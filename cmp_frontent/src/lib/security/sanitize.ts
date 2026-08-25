/**
 * Rendering text the system did not write.
 *
 * React escapes everything it interpolates, so `{noticeText}` is already safe
 * and this module is not needed for it. What it *is* needed for is the handful
 * of places where a value is used somewhere React's escaping does not reach:
 * an `href`, a `download` filename, a `window.open` target, a blob URL.
 *
 * Those are the injection points that survive a framework that "escapes
 * everything", because the escaping happens on text nodes and these are not
 * text nodes.
 */

/**
 * Is this a character that is invisible, or that a browser strips before it
 * parses a URL?
 *
 * Written as codepoint arithmetic rather than a regex character class on
 * purpose. The characters in question have no glyph, so a literal class is a
 * line of source nobody can read, review, or resolve a merge conflict in — and
 * a single missing character in it is a silent hole.
 *
 * The set matters because a browser removes these *before* parsing the scheme.
 * `java{NUL}script:` and `java{TAB}script:` both reach the URL parser as
 * `javascript:`, so a prefix check that runs before removal waves through a
 * string that then executes.
 */
function isInvisible(codePoint: number): boolean {
  return (
    codePoint <= 0x1f || // C0 controls, including NUL, TAB, CR and LF
    (codePoint >= 0x7f && codePoint <= 0x9f) || // DEL and the C1 controls
    (codePoint >= 0x200b && codePoint <= 0x200d) || // zero-width space/non-joiner/joiner
    codePoint === 0x2060 || // word joiner
    codePoint === 0xfeff // byte-order mark
  );
}

/** The same characters, plus the ones Windows and POSIX treat as path syntax. */
function isUnsafeInFilename(char: string): boolean {
  return isInvisible(char.codePointAt(0) ?? 0) || '<>:"|?*'.includes(char);
}

function strip(value: string, reject: (char: string) => boolean): string {
  // Iterating the string yields whole code points, so an astral character is
  // tested once rather than as two lone surrogates.
  let out = "";
  for (const char of value) if (!reject(char)) out += char;
  return out;
}

/**
 * A URL safe to put in an `href`.
 *
 * The attack this stops is `javascript:alert(1)` arriving as a notice's
 * withdrawal URL. The API constrains those to http(s) at the boundary, and this
 * is the second line — a value that reached the browser some other way, or an
 * API that was relaxed later, still cannot become executable.
 *
 * Returns null rather than a placeholder. The caller has to decide what to
 * render when a link is unusable; silently substituting `#` produces a link
 * that looks fine and goes nowhere.
 */
export function safeHref(value: string | null | undefined): string | null {
  if (!value) return null;

  const cleaned = strip(value.trim(), (c) => isInvisible(c.codePointAt(0) ?? 0));
  if (!cleaned) return null;

  // Relative and same-origin absolute paths are fine and common. `//` is not:
  // it is protocol-relative, and points at somebody else's origin.
  if (cleaned.startsWith("/")) return cleaned.startsWith("//") ? null : cleaned;

  try {
    const url = new URL(cleaned);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    // Not a URL at all. Refuse rather than guess.
    return null;
  }
}

/**
 * A `mailto:` that cannot carry a header injection.
 *
 * A newline in an address lets an attacker append `?bcc=` and turn a support
 * link into a mail relay.
 */
export function safeMailto(email: string | null | undefined): string | null {
  if (!email) return null;
  const cleaned = strip(email.trim(), (c) => isInvisible(c.codePointAt(0) ?? 0));
  // Deliberately strict: a real address has no whitespace, no comma, no angle
  // bracket, and exactly one @.
  if (!/^[^\s<>,;:"()[\]\\@]+@[^\s<>,;:"()[\]\\@]+\.[a-z]{2,}$/i.test(cleaned)) return null;
  return `mailto:${encodeURIComponent(cleaned).replace(/%40/g, "@")}`;
}

/**
 * A filename safe to hand a browser's `download` attribute.
 *
 * The server already sends a sanitised `Content-Disposition`, and this is the
 * fallback used when it does not. Path separators are the whole risk: a
 * filename of `../../autorun.inf` is a download that lands somewhere nobody
 * chose.
 */
export function safeFilename(value: string | null | undefined, fallback = "download"): string {
  if (!value) return fallback;
  const cleaned = strip(value.replace(/[/\\]/g, "-"), isUnsafeInFilename)
    // A leading dot hides the file on POSIX; a trailing dot is dropped by
    // Windows, which is how `report.txt.` quietly becomes `report.txt`.
    .replace(/^\.+/, "")
    .replace(/\.+$/, "")
    .trim()
    .slice(0, 200);
  return cleaned || fallback;
}

/**
 * Truncate for display without cutting a surrogate pair in half.
 *
 * `slice()` on a string containing an emoji or a Devanagari conjunct can leave
 * half a code point behind, which renders as a replacement character. This
 * system displays names and notice text in eight Indian languages, so that is
 * not a hypothetical.
 */
export function truncate(value: string, max: number): string {
  const chars = Array.from(value);
  if (chars.length <= max) return value;
  return chars.slice(0, Math.max(0, max - 1)).join("") + "…";
}
