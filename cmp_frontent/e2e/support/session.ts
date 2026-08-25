/**
 * Where each role's saved browser session lives.
 *
 * A plain module rather than an export from `auth.setup.ts`, because Playwright
 * refuses to let a spec import a test file — and it is right to: importing one
 * would run its `setup()` registrations inside the importing file's project.
 *
 * The sessions themselves are written by `auth.setup.ts`, which runs first as a
 * project dependency.
 */
import path from "node:path";

export const STATE_DIR = path.join(__dirname, "..", ".auth");

/** `statePath("dpo")` -> the DPO's saved cookies. */
export function statePath(role: string): string {
  return path.join(STATE_DIR, `${role}.json`);
}
