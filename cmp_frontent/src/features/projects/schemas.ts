/**
 * What a valid project, site, agent link and approval looks like.
 *
 * Built from `@/schemas` primitives so the bounds match the API's rather than
 * being re-guessed per form. The messages are written for the person filling
 * the form in, not for the developer reading the stack trace.
 */

import { z } from "zod";

import { PROOF, fileSchema } from "@/schemas/files";
import {
  codeText,
  future,
  optional,
  pastOrToday,
  refText,
  shortText,
  longText,
  uuid,
} from "@/schemas/primitives";

/* --------------------------------------------------------------- project */

export const projectSchema = z.object({
  project_name: shortText("A project name"),
  // No max here beyond LongText's: the description is what a DPO reads to
  // decide whether the purposes are honest, and truncating it at review time
  // would be exactly the wrong economy.
  description: longText("A description of what this project collects and why"),
  dco_user_uuid: uuid("The Data Collection Owner"),
  internal_project_name: optional(shortText("The internal name")),
  requesting_team: optional(refText("The requesting team")),
});

export type ProjectValues = z.infer<typeof projectSchema>;

export const closeProjectSchema = z.object({
  reason: optional(z.string().trim().max(1000, "Keep the reason under 1,000 characters")),
});

export type CloseProjectValues = z.infer<typeof closeProjectSchema>;

/* ------------------------------------------------------------------ site */

export const siteSchema = z.object({
  // 160 rather than the usual 200: this is the `varchar(160)` the column holds.
  site_label: z
    .string()
    .trim()
    .min(1, "A label is required")
    .max(160, "A site label has to fit in 160 characters"),
  location: optional(shortText("The location")),
  processor_uuid: optional(uuid("The processor")),
  source_uuid: optional(uuid("The data source")),
});

export type SiteValues = z.infer<typeof siteSchema>;

/* ----------------------------------------------------------- agent link */

/**
 * A capability link handed to a field agent.
 *
 * Both bounds exist because this link *is* the authority to collect consent on
 * the organisation's behalf. An expiry in the past would mint something dead;
 * an unbounded use count turns a single leaked URL into an open door.
 */
export const agentSchema = z.object({
  expires_at: future("The expiry date"),
  max_uses: optional(
    z.coerce
      .number({ invalid_type_error: "Enter a number of uses" })
      .int("Uses have to be a whole number")
      .min(1, "A link that can be used zero times is not worth minting")
      .max(100_000, "Split a campaign this large across several links"),
  ),
  agent_ref: optional(refText("The agent reference")),
});

export type AgentValues = z.infer<typeof agentSchema>;

/* -------------------------------------------------------------- approval */

export const approvalSchema = z.object({
  approval_type: codeText("An approval type"),
  reference_no: refText("A reference number"),
  // An approval cannot have been granted tomorrow. The server checks this too;
  // catching it here stops somebody uploading a 20 MB scan to find out.
  approved_on: pastOrToday("The approval date"),
  proof: fileSchema(PROOF),
});

export type ApprovalValues = z.infer<typeof approvalSchema>;
