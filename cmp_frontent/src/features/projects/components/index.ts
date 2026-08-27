/**
 * The project feature's forms and controls.
 *
 * One file per form. They were one 548-line file, which meant a change to the
 * approval upload showed up in the same diff as the project name field and a
 * reviewer had to work out which was which.
 */

export { ProjectForm } from "@/features/projects/components/project-form";
export { SiteForm } from "@/features/projects/components/site-form";
export { AgentForm } from "@/features/projects/components/agent-form";
export { ApprovalForm } from "@/features/projects/components/approval-form";
export { TransitionControls } from "@/features/projects/components/transition-controls";
export { ProjectProcessors } from "@/features/projects/components/project-processors";
export {
  SiteOwner,
  AssignSiteOwnerDialog,
} from "@/features/projects/components/site-owner";
export {
  OverrideBadge,
  AssignSiteDcoDialog,
} from "@/features/projects/components/site-dco";
