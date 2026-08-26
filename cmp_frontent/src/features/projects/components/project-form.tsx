/**
 * Creating and editing a project.
 *
 * The DCO nomination is the field worth knowing about: an R&D User must
 * name one and has no permission to read the account register, so the
 * options come from a narrow `assignable-dcos` lookup rather than from
 * `/users`.
 */
"use client";

import { FormError, useApiForm } from "@/components/forms";
import { DialogFooter } from "@/components/ui/dialog";
import { Button, Field, Input, Select, Textarea } from "@/components/ui/primitives";
import { useCreateProject, useUpdateProject } from "@/features/projects";
import { useAssignableDcos } from "@/features/projects";
import type { Project } from "@/types";
import { useToast } from "@/providers";
import { projectSchema } from "@/features/projects/schemas";

export function ProjectForm({ project, onDone }: { project?: Project; onDone: () => void }) {
  const toast = useToast();
  const create = useCreateProject();
  const update = useUpdateProject(project?.project_uuid ?? "");

  // A narrow lookup, not the account register: an R&D User must nominate a DCO
  // but has no permission to read /users, so this endpoint exists to make the
  // requirement satisfiable without opening the register to them.
  const { data: dcos } = useAssignableDcos();

  const form = useApiForm(projectSchema, {
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
