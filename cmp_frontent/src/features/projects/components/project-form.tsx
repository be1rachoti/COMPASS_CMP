/**
 * Creating and editing a project.
 *
 * The processor selection is the field worth knowing about, and it replaced a
 * DCO nomination. Who *collects* is the first decision and it is knowable on
 * day one; who is *accountable* follows from the data sources chosen under that
 * processor, and those do not exist yet. Asking an R&D User to name a DCO here
 * was asking them to answer on behalf of a decision nobody had taken — and the
 * answer then had to survive until somebody noticed it was wrong.
 *
 * It is a multi-select because a study running at a partner campus and in-house
 * at the same time is ordinary rather than exceptional, and because the mix is
 * what decides the routing: any third party puts the project in a DCO Admin's
 * queue, and an in-house one sends it back to the author to name an RCO.
 */
"use client";

import { Building2, Home } from "lucide-react";
import * as React from "react";

import { FormError, useApiForm } from "@/components/forms";
import { DialogFooter } from "@/components/ui/dialog";
import { Alert, Button, Field, Input, Textarea } from "@/components/ui/primitives";
import { useCreateProject, useUpdateProject } from "@/features/projects";
import { projectSchema } from "@/features/projects/schemas";
import { useProcessors } from "@/features/registry";
import { useToast } from "@/providers";
import type { Project } from "@/types";

export function ProjectForm({ project, onDone }: { project?: Project; onDone: () => void }) {
  const toast = useToast();
  const create = useCreateProject();
  const update = useUpdateProject(project?.project_uuid ?? "");

  // Active only. A suspended processor is one the organisation has stopped
  // collecting through, so offering it would let somebody schedule collection
  // that must not happen — and the server refuses it anyway, which would show
  // up as an error on submit rather than an option that was never there.
  const { data: processors } = useProcessors({ status: "active" });

  const form = useApiForm(projectSchema, {
    project_name: project?.project_name ?? "",
    description: project?.description ?? "",
    processor_uuids: [] as string[],
    internal_project_name: project?.internal_project_name ?? "",
    requesting_team: project?.requesting_team ?? "",
  });

  const chosen = form.watch("processor_uuids") ?? [];
  const busy = create.isPending || update.isPending;

  function toggle(uuid: string) {
    const next = chosen.includes(uuid)
      ? chosen.filter((u) => u !== uuid)
      : [...chosen, uuid];
    form.setValue("processor_uuids", next, { shouldValidate: true, shouldDirty: true });
  }

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
      toast.success(
        "Project registered",
        "It starts in draft. Attach a notice and an approval, then send it to the DPO.",
      );
    }
    onDone();
  });

  return (
    <form method="post" onSubmit={onSubmit} noValidate>
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

        <Field label="Description" error={form.formState.errors.description?.message} required>
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
          <fieldset>
            <legend className="text-sm font-medium">Who will collect</legend>
            <p className="mb-2 mt-0.5 text-xs text-text-muted">
              Choose one or more. A study can run at a partner site and in-house at the same
              time. The data sources under each are chosen later, once it is approved.
            </p>

            {!processors?.items.length ? (
              <Alert tone="info">
                No active processors are registered yet. Add one from{" "}
                <strong>Processors</strong> before registering a project.
              </Alert>
            ) : (
              <div className="grid gap-1.5 sm:grid-cols-2">
                {processors.items.map((pr) => (
                  <label
                    key={pr.processor_uuid}
                    className="grid cursor-pointer grid-cols-[auto_1fr] items-center gap-x-2 gap-y-0.5 rounded-lg border border-border px-2.5 py-2 text-sm transition-colors hover:bg-bg-inset has-[:checked]:border-accent-border has-[:checked]:bg-accent-subtle"
                  >
                    <input
                      type="checkbox"
                      checked={chosen.includes(pr.processor_uuid)}
                      onChange={() => toggle(pr.processor_uuid)}
                      className="size-4 rounded border-border-strong accent-[var(--accent)]"
                    />
                    <span className="block min-w-0 truncate font-medium">{pr.legal_name}</span>
                    <span className="col-start-2 flex items-center gap-1 text-2xs text-text-muted">
                      {pr.is_in_house ? (
                        <Home className="size-3" aria-hidden="true" />
                      ) : (
                        <Building2 className="size-3" aria-hidden="true" />
                      )}
                      {pr.is_in_house ? "collected in-house" : "collected by a third party"}
                    </span>
                  </label>
                ))}
              </div>
            )}

            {form.formState.errors.processor_uuids?.message && (
              <p className="mt-2 text-xs text-danger-text">
                {form.formState.errors.processor_uuids.message}
              </p>
            )}

            <RoutingNote
              inHouse={chosen.some((u) => byUuid(processors?.items, u)?.is_in_house)}
              thirdParty={chosen.some((u) => byUuid(processors?.items, u)?.is_in_house === false)}
            />
          </fieldset>
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

function byUuid<T extends { processor_uuid: string }>(items: T[] | undefined, uuid: string) {
  return items?.find((i) => i.processor_uuid === uuid);
}

/**
 * What happens after approval, said before the choice is made.
 *
 * The routing consequence is invisible otherwise: the same form produces a
 * project that lands in somebody else's queue or comes back to the author, and
 * which one depends on a checkbox whose label does not say so.
 */
function RoutingNote({ inHouse, thirdParty }: { inHouse: boolean; thirdParty: boolean }) {
  if (!inHouse && !thirdParty) return null;
  return (
    <Alert tone="info" className="mt-3">
      Once the DPO approves this,{" "}
      {thirdParty && "the DCO Admin assigns the data sources for the third-party collection"}
      {thirdParty && inHouse && ", and "}
      {inHouse && "it comes back to you to name the data sources and an R&D Collection Owner"}.
    </Alert>
  );
}
