/**
 * Every `<form>` in the application declares `method="post"`.
 *
 * A source-level test, which is unusual and is the right shape here: the
 * invariant is about markup that exists across nineteen files, and no
 * per-component test would catch the twentieth.
 *
 * ## The bug it exists to prevent
 *
 * React attaches `onSubmit` at hydration. If somebody presses a submit button
 * before that lands — a cold cache, a slow connection, a chunk that 404s — the
 * browser performs the **native** submission instead. HTML's default method is
 * GET, so every field is appended to the URL as a query string.
 *
 * On the sign-in form that produced, verbatim:
 *
 *     /sign-in?login=dpo%40cmp.local&password=SeedPassw0rd%212026
 *
 * The password is then in browser history, in the server's access log, and in
 * the `Referer` header of the next request the page makes. Nothing errors and
 * nothing is logged as wrong.
 *
 * With `method="post"` the unhydrated case posts to a page route and fails
 * visibly, having put nothing in the URL.
 *
 * This was observed on a real page load, not reasoned about.
 */

import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const SRC = path.join(__dirname, "..");

function tsxFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return tsxFiles(full);
    return entry.isFile() && entry.name.endsWith(".tsx") ? [full] : [];
  });
}

describe("every form posts", () => {
  const files = tsxFiles(SRC);

  it("finds the forms to check", () => {
    // A guard on the guard: if the traversal breaks, the assertion below would
    // pass vacuously and this test would report success while checking nothing.
    const withForms = files.filter((f) => fs.readFileSync(f, "utf8").includes("<form"));
    expect(withForms.length).toBeGreaterThan(10);
  });

  it("declares method=\"post\" on every one", () => {
    const offenders: string[] = [];

    for (const file of files) {
      const source = fs.readFileSync(file, "utf8");
      // Opening tags only, and only ones that are not already POST. The tag can
      // span lines, so match up to the first `>` that is not inside braces.
      for (const match of source.matchAll(/<form\b([^>]*)>/g)) {
        if (!/\bmethod=["']post["']/i.test(match[1])) {
          offenders.push(`${path.relative(SRC, file)}: <form${match[1].slice(0, 60)}>`);
        }
      }
    }

    expect(offenders, `forms without method="post":\n${offenders.join("\n")}`).toEqual([]);
  });
});
