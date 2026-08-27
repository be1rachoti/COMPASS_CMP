/**
 * What a valid export request and import manifest submission look like.
 *
 * Both sides of the same boundary — data leaving, data arriving — and both are
 * validated more carefully than an ordinary form because the failure modes are
 * asymmetric. A rejected import is obvious and gets fixed; the dangerous
 * outcome is a manifest that is accepted with rows nobody is looking at.
 */

import { z } from "zod";

import { MANIFEST, fileSchema } from "@/schemas/files";
import { optional, uuid } from "@/schemas/primitives";

/* ---------------------------------------------------------------- export */

// The export form has no fields: one kind of export, covering the project, with
// its contents decided by who is asking. Nothing left to validate.

/* ---------------------------------------------------------------- import */

/**
 * A manifest submission.
 *
 * `project` is optional on validation and required on submit, which is why it
 * is optional here and checked at the call site: the validate step exists
 * precisely so somebody can check a file before deciding which project it
 * belongs to.
 */
export const manifestSchema = z.object({
  source: uuid("The data source"),
  project: optional(uuid("The project")),
  manifest: fileSchema(MANIFEST),
});

export type ManifestValues = z.infer<typeof manifestSchema>;

/** The same, once a project has been chosen and the submission is real. */
export const manifestSubmitSchema = manifestSchema.extend({
  project: uuid("The project"),
});

export type ManifestSubmitValues = z.infer<typeof manifestSubmitSchema>;
