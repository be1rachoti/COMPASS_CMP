/**
 * Formatting.
 *
 * These functions render values that a data subject reads on a consent notice and
 * that a DPO reads on an evidence page. "3 years" versus "P3Y" is the difference
 * between a notice somebody understands and one they do not.
 */
import { describe, expect, it } from "vitest";

import {
  cn,
  formatBytes,
  formatDate,
  formatDateTime,
  formatDuration,
  humanise,
  initials,
  shortHash,
} from "./utils";

describe("cn", () => {
  it("lets a later Tailwind utility win", () => {
    // Without twMerge both classes are emitted and the winner depends on
    // stylesheet order, so a variant prop silently fails to override a default.
    expect(cn("p-2", "p-4")).toBe("p-4");
    expect(cn("text-sm text-text", "text-lg")).toBe("text-text text-lg");
  });

  it("handles conditionals and falsy values", () => {
    expect(cn("base", false && "hidden", null, undefined, "extra")).toBe("base extra");
  });
});

describe("dates", () => {
  it("renders an absolute timestamp", () => {
    // Absolute, not relative: this is an evidence record, and "3 days ago" is
    // not a date anyone can quote.
    const rendered = formatDateTime("2026-08-24T14:30:00Z");
    expect(rendered).toMatch(/2026/);
    expect(rendered).toMatch(/Aug/);
  });

  it("renders a date without a time", () => {
    const rendered = formatDate("2026-08-24");
    expect(rendered).toMatch(/2026/);
    expect(rendered).not.toMatch(/:/);
  });

  it("shows an em dash rather than 'Invalid Date'", () => {
    for (const value of [null, undefined, "", "not-a-date"]) {
      expect(formatDateTime(value)).toBe("—");
      expect(formatDate(value)).toBe("—");
    }
  });
});

describe("formatDuration", () => {
  it("renders an ISO-8601 interval in words", () => {
    expect(formatDuration("P3Y")).toBe("3 years");
    expect(formatDuration("P1Y")).toBe("1 year");
    expect(formatDuration("P6M")).toBe("6 months");
    expect(formatDuration("P30D")).toBe("30 days");
  });

  it("combines components", () => {
    expect(formatDuration("P1Y6M")).toBe("1 year, 6 months");
  });

  it("collapses PostgreSQL day intervals to the natural unit", () => {
    // A retention period shown as "1095 days" is technically right and useless
    // on a notice somebody is reading on a phone.
    expect(formatDuration("1095 days")).toBe("3 years");
    expect(formatDuration("365 days")).toBe("1 year");
    expect(formatDuration("90 days")).toBe("3 months");
    expect(formatDuration("14 days")).toBe("14 days");
  });

  it("passes through anything it does not recognise", () => {
    expect(formatDuration("indefinite")).toBe("indefinite");
    expect(formatDuration(null)).toBe("—");
  });
});

describe("shortHash", () => {
  const hash = "553e88779333e005893bb1135b7b742ae7f756a845e3ff400d7301124083b7c4";

  it("keeps both ends", () => {
    // A prefix-only truncation can be forged by anyone able to grind a matching
    // prefix; keeping the tail makes an eyeball comparison meaningful.
    const short = shortHash(hash);
    expect(short).toContain("553e8877");
    expect(short).toContain("4083b7c4");
    expect(short).toContain("…");
  });

  it("returns a short value unchanged", () => {
    expect(shortHash("abc123")).toBe("abc123");
  });

  it("handles nothing", () => {
    expect(shortHash(null)).toBe("—");
  });
});

describe("humanise", () => {
  it("turns an enum value into a label", () => {
    expect(humanise("under_process")).toBe("Under process");
    expect(humanise("pending_approval")).toBe("Pending approval");
  });

  it("handles nothing", () => {
    expect(humanise(null)).toBe("—");
    expect(humanise("")).toBe("—");
  });
});

describe("initials", () => {
  it("uses the first and last name", () => {
    expect(initials("Priya Menon")).toBe("PM");
    expect(initials("Anita Rani Desai")).toBe("AD");
  });

  it("handles a single name", () => {
    expect(initials("Priya")).toBe("PR");
    expect(initials("A")).toBe("A");
  });

  it("handles nothing", () => {
    expect(initials(null)).toBe("?");
  });
});

describe("formatBytes", () => {
  it("scales to the right unit", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(26_214_400)).toBe("25.0 MB");
  });
});
