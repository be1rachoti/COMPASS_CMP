/**
 * Project, site, agent-link and approval forms.
 *
 * Three of these encode a rule that is easy to get wrong:
 *
 * - **A project needs a nominated DCO at creation.** Not later — it is one of
 *   the three preconditions for the implicit `— → in_draft` transition.
 * - **A consent link has no default expiry.** `expires_at` is required with no
 *   pre-filled value and no maximum. The absence of a default *is* the control:
 *   someone has to decide how long this link should live, and a pre-fill would
 *   be chosen once and never revisited.
 * - **An approval without a proof file does not count** (INV-8). The file is
 *   required by the form because it is required by the transition.
 */
"use client";

import { AlertTriangle, Copy, Check } from "lucide-react";
import * as React from "react";
import { z } from "zod";

import { FileInput, FormError, useApiForm } from "@/components/forms/form";
import { DialogFooter } from "@/components/ui/dialog";
import { Alert, Button, Field, Input, Mono, Select, Textarea } from "@/components/ui/primitives";
import {
  useAssignAgent,
  useCreateProject,
  useCreateSite,
  useUpdateProject,
  useUploadApproval,
  type MintedLink,
} from "@/lib/mutations";
import { useAssignableDcos, useEnums, useProcessors, useSources } from "@/lib/queries";
import type { Project } from "@/lib/types";
import { useToast } from "@/providers";

/* ================================================================== project */

const projectSchema = z.object({
  project_name: z.string().min(1, "A name is required").max(200),
  description: z.string().min(1, "Describe what this project collects and why"),
  dco_user_uuid: z.string().min(1, "Nominate a Data Collection Owner"),
  internal_project_name: z.string().max(200).optional().nullable(),
  requesting_team: z.string().max(120).optional().nullable(),
});

type ProjectValues = z.infer<typeof projectSchema>;

export function ProjectForm({ project, onDone }: { project?: Project; onDone: () => void }) {
  const toast = useToast();
  const create = useCreateProject();
  const update = useUpdateProject(project?.project_uuid ?? "");

  // A narrow lookup, not the account register: an R&D User must nominate a DCO
  // but has no permission to read /users, so this endpoint exists to make the
  // requirement satisfiable without opening the register to them.
  const { data: dcos } = useAssignableDcos();

  const form = useApiForm<ProjectValues>(projectSchema, {
    project_name: project?.project_name ?? "",
    description: project?.description ?? "",
    dco_user_uuid: project?.dco_uuid ?? "",
    internal_project_name: project?.internal_project_name ?? "",
    requesting_team: project?.requesting_team ?? "",
  });

  const busy = create.isPending || update.isPending;

  const onSubmit = form.submit(async (values) => {
    const payload = {
      ...values,
      internal_project_name: values.internal_project_name || null,
      requesting_team: values.requesting_team || null,
    };
    if (project) {
      // Editing is permitted only while the project is in draft.
      await update.mutateAsync({
        project_name: payload.project_name,
        description: payload.description,
        internal_project_name: payload.internal_project_name,
        requesting_team: payload.requesting_team,
      });
      toast.success("Project updated");
    } else {
      await create.mutateAsync(payload);
      toast.success("Project registered", "It starts in draft. The DPO publishes the notice.");
    }
    onDone();
  });

  return (
    <form onSubmit={onSubmit} noValidate>
      <FormError message={form.formError} />

      <div className="space-y-4">
        <Field
          label="Project name"
          hint="What a data subject would recognise it as."
          error={form.formState.errors.project_name?.message}
          required
        >
          {(p) => (
            <Input
              {...p}
              {...form.register("project_name")}
              placeholder="Gait Identification Study 2026"
            />
          )}
        </Field>

        <Field
          label="Description"
          error={form.formState.errors.description?.message}
          required
        >
          {(p) => (
            <Textarea
              {...p}
              {...form.register("description")}
              rows={3}
              placeholder="Collection of gait video and facial images for model training."
            />
          )}
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Internal name" hint="Optional. Not shown to data subjects.">
            {(p) => (
              <Input {...p} {...form.register("internal_project_name")} placeholder="GAIT-2026" />
            )}
          </Field>

          <Field label="Requesting team" hint="Optional.">
            {(p) => (
              <Input {...p} {...form.register("requesting_team")} placeholder="Computer Vision" />
            )}
          </Field>
        </div>

        {!project && (
          <Field
            label="Data Collection Owner"
            hint="Required to register a project. They will run collection once it is approved."
            error={form.formState.errors.dco_user_uuid?.message}
            required
          >
            {(p) => (
              <Select {...p} {...form.register("dco_user_uuid")}>
                <option value="">Choose a DCO…</option>
                {dcos?.map((u) => (
                  <option key={u.uuid} value={u.uuid}>
                    {u.full_name} · {u.email}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}
      </div>

      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" loading={busy}>
          {project ? "Save changes" : "Register project"}
        </Button>
      </DialogFooter>
    </form>
  );
}

/* ===================================================================== site */

const siteSchema = z.object({
  site_label: z.string().min(1, "A label is required").max(160),
  location: z.string().max(200).optional().nullable(),
  processor_uuid: z.string().optional().nullable(),
  source_uuid: z.string().optional().nullable(),
});

type SiteValues = z.infer<typeof siteSchema>;

export function SiteForm({
  projectUuid,
  noticePublished,
  onDone,
}: {
  projectUuid: string;
  /** Adding a site after publication is a material change - a new recipient the
   *  published text does not name. */
  noticePublished?: boolean;
  onDone: () => void;
}) {
  const toast = useToast();
  const create = useCreateSite(projectUuid);
  const { data: processors } = useProcessors({ status: "active", limit: 100 });

  const form = useApiForm<SiteValues>(siteSchema, {
    site_label: "",
    location: "",
    processor_uuid: "",
    source_uuid: "",
  });

  // The cascade. Watching the processor rather than reading it on submit is what
  // makes the second dropdown a consequence of the first instead of an unrelated
  // list of every rig in the registry.
  const processorUuid = form.watch("processor_uuid") ?? "";
  const { data: sources, isFetching: sourcesLoading } = useSources({
    status: "active",
    limit: 100,
    processor: processorUuid || undefined,
  });

  // A source chosen under one processor is not valid under another, and the API
  // refuses the pair. Clearing it here means the user sees that immediately
  // rather than on submit.
  React.useEffect(() => {
    form.setValue("source_uuid", "");
  }, [processorUuid, form]);

  const onSubmit = form.submit(async (values) => {
    const result = await create.mutateAsync({
      site_label: values.site_label,
      location: values.location || null,
      processor_uuid: values.processor_uuid || null,
      source_uuid: values.source_uuid || null,
    });
    toast.success(
      "Site added",
      result.material_change
        ? "This adds a recipient the published notice does not name. A new notice version is required before collecting here."
        : "It will appear in the notice's recipient list at publication.",
    );
    onDone();
  });

  return (
    <form onSubmit={onSubmit} noValidate>
      <FormError message={form.formError} />

      {noticePublished && (
        <Alert tone="warning" className="mb-4">
          <p className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>
              This project&apos;s notice is already published. Adding a site adds a
              recipient that the published text does not name, which is a material
              change requiring a new notice version before collection starts there.
            </span>
          </p>
        </Alert>
      )}

      <div className="space-y-4">
        <Field
          label="Site label"
          hint="Appears in the notice's recipient list, so name it as a data subject would recognise it."
          error={form.formState.errors.site_label?.message}
          required
        >
          {(p) => <Input {...p} {...form.register("site_label")} placeholder="Pune Motion Lab" />}
        </Field>

        <Field label="Location">
          {(p) => (
            <Input {...p} {...form.register("location")} placeholder="Pune, Maharashtra" />
          )}
        </Field>

        <div className="rounded-lg border border-border bg-bg-subtle p-3">
          <p className="text-2xs font-semibold uppercase tracking-wider text-text-subtle">
            Who runs it, and with what
          </p>

          <div className="mt-3 space-y-4">
            <Field
              label="Processor"
              hint="The organisation operating this site. Leave blank if it is run internally."
            >
              {(p) => (
                <Select {...p} {...form.register("processor_uuid")}>
                  <option value="">Operated internally</option>
                  {processors?.items.map((proc) => (
                    <option key={proc.processor_uuid} value={proc.processor_uuid}>
                      {proc.legal_name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>

            <Field
              label="Data source"
              hint={
                processorUuid
                  ? "The rig that will report from this site. Narrowed to what this processor operates."
                  : "Pick a processor first — the list narrows to what they actually run."
              }
              error={form.formState.errors.source_uuid?.message}
            >
              {(p) => (
                <Select
                  {...p}
                  {...form.register("source_uuid")}
                  disabled={!processorUuid || sourcesLoading}
                >
                  <option value="">
                    {!processorUuid
                      ? "Choose a processor first"
                      : sourcesLoading
                        ? "Loading…"
                        : (sources?.items.length ?? 0) === 0
                          ? "This processor has no active source registered"
                          : "Not decided yet"}
                  </option>
                  {sources?.items.map((src) => (
                    <option key={src.source_uuid} value={src.source_uuid}>
                      {src.name} ({src.source_code})
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
        </div>
      </div>

      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" loading={create.isPending}>
          Add site
        </Button>
      </DialogFooter>
    </form>
  );
}

/* ========================================================== agent / link ==== */

const agentSchema = z.object({
  expires_at: z.string().min(1, "Decide when this link stops working"),
  max_uses: z.coerce.number().int().min(1).max(100_000).optional().nullable(),
  agent_ref: z.string().max(120).optional().nullable(),
});

type AgentValues = z.infer<typeof agentSchema>;

export function AgentForm({ siteUuid, onDone }: { siteUuid: string; onDone: () => void }) {
  const toast = useToast();
  const assign = useAssignAgent(siteUuid);
  const [minted, setMinted] = React.useState<MintedLink | null>(null);

  const form = useApiForm<AgentValues>(agentSchema, {
    // Deliberately empty. The absence of a default expiry is the control.
    expires_at: "",
    max_uses: null,
    agent_ref: "",
  });

  const onSubmit = form.submit(async (values) => {
    const result = await assign.mutateAsync({
      expires_at: new Date(values.expires_at).toISOString(),
      max_uses: values.max_uses || null,
      agent_ref: values.agent_ref || null,
    });
    setMinted(result);
    toast.success("Consent link created");
  });

  if (minted) return <MintedLinkPanel link={minted} onDone={onDone} />;

  return (
    <form onSubmit={onSubmit} noValidate>
      <FormError message={form.formError} />

      <div className="space-y-4">
        <Field
          label="Expires at"
          hint="Required, with no default and no maximum. Somebody has to decide how long this link should live."
          error={form.formState.errors.expires_at?.message}
          required
        >
          {(p) => <Input {...p} type="datetime-local" {...form.register("expires_at")} />}
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Maximum uses"
            hint="Leave blank for unlimited. A cap limits the damage if the link circulates."
            error={form.formState.errors.max_uses?.message}
          >
            {(p) => (
              <Input {...p} type="number" min={1} {...form.register("max_uses")} placeholder="unlimited" />
            )}
          </Field>

          <Field label="Field agent reference" hint="Optional. For your own records.">
            {(p) => <Input {...p} {...form.register("agent_ref")} />}
          </Field>
        </div>
      </div>

      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" loading={assign.isPending}>
          Create link
        </Button>
      </DialogFooter>
    </form>
  );
}

/**
 * The token is shown exactly once.
 *
 * What the database holds is its keyed digest, so this panel is the only chance
 * to capture it. Saying so plainly is better than letting someone close the
 * dialog and discover it later.
 */
function MintedLinkPanel({ link, onDone }: { link: MintedLink; onDone: () => void }) {
  const [copied, setCopied] = React.useState(false);
  const url =
    typeof window !== "undefined" ? `${window.location.origin}${link.url_path}` : link.url_path;

  return (
    <div>
      <Alert tone="warning" title="Copy this now">
        <p>{link.warning}</p>
      </Alert>

      <div className="mt-4 rounded-md border border-border bg-bg-subtle p-3">
        <Mono className="block break-all text-sm">{url}</Mono>
      </div>

      <Button
        variant="secondary"
        className="mt-3"
        onClick={async () => {
          await navigator.clipboard.writeText(url);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        }}
      >
        {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
        {copied ? "Copied" : "Copy link"}
      </Button>

      <p className="mt-4 text-xs text-text-muted">
        Give this to the field agent. Anyone holding it can open the notice and
        consent, so treat it as a credential — it is scrubbed from our access logs
        for the same reason.
      </p>

      <DialogFooter>
        <Button variant="primary" onClick={onDone}>
          Done
        </Button>
      </DialogFooter>
    </div>
  );
}

/* ================================================================= approval */

const approvalSchema = z.object({
  approval_type: z.string().min(1, "Choose a type"),
  reference_no: z.string().min(1, "A reference is required").max(120),
  approved_on: z.string().min(1, "Record the approval date"),
});

type ApprovalValues = z.infer<typeof approvalSchema>;

const MAX_PROOF_BYTES = 25 * 1024 * 1024;

export function ApprovalForm({
  projectUuid,
  onDone,
}: {
  projectUuid: string;
  onDone: () => void;
}) {
  const toast = useToast();
  const { data: enums } = useEnums();
  const upload = useUploadApproval(projectUuid);
  const [file, setFile] = React.useState<File | null>(null);
  const [fileError, setFileError] = React.useState<string | null>(null);

  const form = useApiForm<ApprovalValues>(approvalSchema, {
    approval_type: "security",
    reference_no: "",
    approved_on: "",
  });

  const onSubmit = form.submit(async (values) => {
    // INV-8: the proof is not optional metadata, it is the thing that makes the
    // approval count. Checked here so the user is not told after upload.
    if (!file) {
      setFileError("A proof file is mandatory. An approval without one does not count.");
      return;
    }
    setFileError(null);

    await upload.mutateAsync({ ...values, proof: file });
    toast.success(
      "Approval uploaded",
      "The project can now move to pending approval.",
    );
    onDone();
  });

  return (
    <form onSubmit={onSubmit} noValidate>
      <FormError message={form.formError} />

      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Type" error={form.formState.errors.approval_type?.message} required>
            {(p) => (
              <Select {...p} {...form.register("approval_type")}>
                {enums?.approval_type?.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Field
            label="Reference number"
            error={form.formState.errors.reference_no?.message}
            required
          >
            {(p) => <Input {...p} {...form.register("reference_no")} placeholder="SEC-2026-0142" />}
          </Field>
        </div>

        <Field
          label="Approved on"
          error={form.formState.errors.approved_on?.message}
          required
        >
          {(p) => <Input {...p} type="date" {...form.register("approved_on")} />}
        </Field>

        <FileInput
          label="Proof document"
          hint="PDF or image, up to 25 MB. Stored with its SHA-256 so it can be checked later."
          accept="application/pdf,image/png,image/jpeg"
          maxBytes={MAX_PROOF_BYTES}
          file={file}
          onChange={(f) => {
            setFile(f);
            setFileError(null);
          }}
          error={fileError ?? undefined}
          required
        />
      </div>

      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" loading={upload.isPending}>
          Upload approval
        </Button>
      </DialogFooter>
    </form>
  );
}
