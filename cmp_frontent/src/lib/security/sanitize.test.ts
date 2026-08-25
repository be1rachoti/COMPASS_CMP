/**
 * The sanitisers, against the payloads they exist to refuse.
 *
 * Each case here is a real bypass technique rather than an invented one, and
 * two of them are bugs this module actually had: the control-character strip
 * was matching nothing, and `safeHref` treated `//evil.example` as a
 * same-origin path. Both are asserted below so neither comes back.
 */

import { describe, expect, it } from "vitest";

import { safeFilename, safeHref, safeMailto, safeRedirectPath, truncate } from "@/lib/security";

describe("safeHref", () => {
  it("allows the schemes a person can actually follow", () => {
    expect(safeHref("https://board.example/complaints")).toBe(
      "https://board.example/complaints",
    );
    expect(safeHref("http://intranet.example/withdraw")).toBe(
      "http://intranet.example/withdraw",
    );
  });

  it("allows a same-origin path", () => {
    expect(safeHref("/my-consents")).toBe("/my-consents");
  });

  it("refuses javascript:", () => {
    expect(safeHref("javascript:alert(1)")).toBeNull();
    expect(safeHref("JavaScript:alert(1)")).toBeNull();
    expect(safeHref("  javascript:alert(1)  ")).toBeNull();
  });

  it("refuses javascript: hidden behind characters the browser strips first", () => {
    // The reason the strip has to happen before the scheme check: a browser
    // removes these itself, so a check that runs on the raw string sees
    // something inert and lets through something that executes.
    expect(safeHref("java\u0000script:alert(1)")).toBeNull();
    expect(safeHref("java\tscript:alert(1)")).toBeNull();
    expect(safeHref("java\nscript:alert(1)")).toBeNull();
    expect(safeHref("java\u200bscript:alert(1)")).toBeNull();
    expect(safeHref("\ufeffjavascript:alert(1)")).toBeNull();
  });

  it("refuses data: and other executable schemes", () => {
    expect(safeHref("data:text/html;base64,PHNjcmlwdD4=")).toBeNull();
    expect(safeHref("vbscript:msgbox(1)")).toBeNull();
    expect(safeHref("file:///etc/passwd")).toBeNull();
  });

  it("refuses a protocol-relative URL, which is not a same-origin path", () => {
    // This was a real bug: `//evil.example` starts with a slash and was
    // treated as a path. It is not - it inherits the current scheme and points
    // at somebody else's host.
    expect(safeHref("//evil.example/steal")).toBeNull();
  });

  it("returns null rather than a placeholder", () => {
    // A caller has to decide what to render for an unusable link. Substituting
    // `#` produces a link that looks fine and goes nowhere.
    expect(safeHref("")).toBeNull();
    expect(safeHref(null)).toBeNull();
    expect(safeHref("   ")).toBeNull();
  });
});

describe("safeMailto", () => {
  it("accepts an ordinary address", () => {
    expect(safeMailto("dpo@organisation.example")).toBe("mailto:dpo@organisation.example");
  });

  it("refuses an address carrying a header injection", () => {
    // A newline lets an attacker append `?bcc=` and turn a support link into a
    // mail relay.
    expect(safeMailto("dpo@example.com\nbcc:everyone@example.com")).toBeNull();
    expect(safeMailto("dpo@example.com%0Abcc:x@y.z")).toBeNull();
    expect(safeMailto("dpo@example.com,attacker@evil.example")).toBeNull();
  });

  it("refuses anything that is not one address", () => {
    expect(safeMailto("not an address")).toBeNull();
    expect(safeMailto("a@b@c.com")).toBeNull();
    expect(safeMailto("@example.com")).toBeNull();
  });
});

describe("safeFilename", () => {
  it("keeps an ordinary name", () => {
    expect(safeFilename("consent-export-2026-02.csv")).toBe("consent-export-2026-02.csv");
  });

  it("refuses to let a filename escape its directory", () => {
    // The property that matters is the absence of separators — without one, a
    // name cannot address anything but the directory it is saved into. The dot
    // run goes too, because a traversal sequence surviving in any form invites
    // somebody downstream to put the slashes back.
    for (const name of ["../../autorun.inf", "..\\..\\autorun.inf", "/etc/passwd"]) {
      const safe = safeFilename(name);
      expect(safe).not.toContain("/");
      expect(safe).not.toContain("\\");
      expect(safe).not.toContain("..");
    }
  });

  it("strips control characters", () => {
    expect(safeFilename("report\u0000.csv")).toBe("report.csv");
  });

  it("falls back when nothing usable is left", () => {
    expect(safeFilename("...")).toBe("download");
    expect(safeFilename("")).toBe("download");
    expect(safeFilename(null)).toBe("download");
  });
});

describe("safeRedirectPath", () => {
  it("keeps a same-origin path", () => {
    expect(safeRedirectPath("/projects")).toBe("/projects");
    expect(safeRedirectPath("/consents?status=granted")).toBe("/consents?status=granted");
  });

  it("refuses an absolute URL", () => {
    // The open-redirect this closes: a link that starts on this origin, shows
    // this organisation's sign-in page, and lands the user somewhere else with
    // their trust already established.
    expect(safeRedirectPath("https://evil.example", "/dashboard")).toBe("/dashboard");
    expect(safeRedirectPath("http://evil.example", "/dashboard")).toBe("/dashboard");
  });

  it("refuses the forms that look like a path and are not", () => {
    expect(safeRedirectPath("//evil.example", "/dashboard")).toBe("/dashboard");
    expect(safeRedirectPath("/\\evil.example", "/dashboard")).toBe("/dashboard");
    expect(safeRedirectPath("javascript:alert(1)", "/dashboard")).toBe("/dashboard");
    expect(safeRedirectPath("/\u0000/evil.example", "/dashboard")).toBe("/dashboard");
  });

  it("falls back when there is nothing to go on", () => {
    expect(safeRedirectPath(null, "/dashboard")).toBe("/dashboard");
    expect(safeRedirectPath("", "/dashboard")).toBe("/dashboard");
  });
});

describe("truncate", () => {
  it("leaves a short string alone", () => {
    expect(truncate("Retail footfall", 40)).toBe("Retail footfall");
  });

  it("does not cut a surrogate pair in half", () => {
    // A half code point renders as a replacement character. This system shows
    // names and notice text in eight Indian languages, so it is not a
    // hypothetical.
    const withEmoji = "abc\u{1F1EE}\u{1F1F3}def";
    const result = truncate(withEmoji, 5);
    expect(result).not.toContain("\uFFFD");
    expect([...result].length).toBeLessThanOrEqual(5);
  });

  it("counts code points, not UTF-16 units", () => {
    const devanagari = "नमस्ते नमस्ते नमस्ते";
    expect(truncate(devanagari, 5)).toBe([...devanagari].slice(0, 4).join("") + "…");
  });
});
