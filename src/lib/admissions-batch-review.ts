import { z } from "zod";
import type { StaffNewStudentAdmissionsOperation } from "@/lib/admissions-workspace";

export const implementedNewStudentBatchActions = ["invite_application", "close_abandoned"] as const;
export type ImplementedNewStudentBatchAction = (typeof implementedNewStudentBatchActions)[number];

export const admissionsBatchReviewRequestSchema = z.object({
  workspace: z.literal("new_students"),
  action: z.enum(implementedNewStudentBatchActions),
  scope: z.enum(["one", "selected", "all_matching"]),
  selected_ids: z.array(z.string().uuid()).max(500),
  filters: z.object({
    search: z.string().trim().max(100).default(""),
    attention: z.enum(["all", "needs_attention", "ready", "waiting"]).default("all"),
    stage: z.enum(["all", "enquiry", "application", "review", "offer", "registration", "complete", "closed"]).default("all")
  }),
  action_reason: z.string().trim().max(4000).nullable().optional(),
  rendered_subject: z.string().trim().max(300).nullable().optional(),
  rendered_body: z.string().trim().max(12000).nullable().optional(),
  request_key: z.string().uuid().optional()
}).superRefine((request, context) => {
  if (request.scope === "one" && request.selected_ids.length !== 1) {
    context.addIssue({ code: "custom", message: "One-record scope requires exactly one selected record.", path: ["selected_ids"] });
  }
  if (request.scope === "selected" && request.selected_ids.length === 0) {
    context.addIssue({ code: "custom", message: "Selected scope requires at least one selected record.", path: ["selected_ids"] });
  }
  if (request.scope === "all_matching" && request.selected_ids.length > 0) {
    context.addIssue({ code: "custom", message: "All-matching scope is defined by reviewed filters, not selected IDs.", path: ["selected_ids"] });
  }
  if (request.action === "close_abandoned" && !request.action_reason) {
    context.addIssue({ code: "custom", message: "Closing admissions records requires a reason.", path: ["action_reason"] });
  }
  if (request.action === "invite_application" && (!request.rendered_subject || !request.rendered_body)) {
    context.addIssue({ code: "custom", message: "Invitation batches require a reviewed subject and message.", path: ["rendered_body"] });
  } else if (request.action === "invite_application" && !request.rendered_body?.includes("{{action_link}}")) {
    context.addIssue({ code: "custom", message: "Invitation messages must include the secure {{action_link}} placeholder.", path: ["rendered_body"] });
  } else if (request.action === "invite_application" && !request.rendered_body?.includes("{{applicant_login_link}}")) {
    context.addIssue({ code: "custom", message: "Invitation messages must include the return-access {{applicant_login_link}} placeholder.", path: ["rendered_body"] });
  }
});

export type AdmissionsBatchReviewRequest = z.infer<typeof admissionsBatchReviewRequestSchema>;

export interface AdmissionsBatchReviewedTarget {
  entity_type: "admission_lead";
  entity_id: string;
  person_id?: string | null;
  recipient_email?: string | null;
  recipient_name?: string | null;
  eligible: boolean;
  exclusion_reason?: string | null;
  source_snapshot: Record<string, string | number | boolean | null>;
}

export interface AdmissionsBatchPreview {
  workspace: "new_students";
  action: ImplementedNewStudentBatchAction;
  scope: "one" | "selected" | "all_matching";
  reviewedCount: number;
  eligibleCount: number;
  excludedCount: number;
  targets: AdmissionsBatchReviewedTarget[];
}

export function admissionsBatchPreviewBlockingMessage(preview: AdmissionsBatchPreview): string | null {
  if (preview.eligibleCount > 0) return null;

  const emailDisabled = preview.action === "invite_application"
    && preview.targets.length > 0
    && preview.targets.every((target) => target.exclusion_reason === "Email delivery is disabled.");
  if (emailDisabled) {
    return "Email delivery is disabled, so this invitation batch cannot be queued. Enable and configure pilot delivery, then preview the records again.";
  }

  return "No reviewed records are eligible for this action. Check the exclusion reasons, adjust the selection or filters, then preview again.";
}

export function newStudentBatchEligibility(
  action: ImplementedNewStudentBatchAction,
  item: StaffNewStudentAdmissionsOperation
): { eligible: true } | { eligible: false; reason: string } {
  if (item.hasDataInconsistency) {
    return { eligible: false, reason: "Data inconsistency must be repaired before this action." };
  }

  if (action === "invite_application") {
    if (!["interest", "application_invited"].includes(item.sourceLeadStage)) {
      return { eligible: false, reason: "Only an enquiry or existing application invitation can be invited." };
    }
    if (!["enquiry", "application"].includes(item.journeyStage) || item.applicationStatus === "submitted") {
      return { eligible: false, reason: "The application has progressed beyond invitation or access." };
    }
    return { eligible: true };
  }

  if (
    !["interest", "application_invited"].includes(item.sourceLeadStage)
    || !["enquiry", "application"].includes(item.journeyStage)
    || item.applicationStatus === "submitted"
  ) {
    return { eligible: false, reason: "Only enquiries and unsubmitted applications can be closed as abandoned." };
  }
  return { eligible: true };
}

export function batchScopeForSelection(allMatching: boolean, selectedCount: number) {
  if (allMatching) return "all_matching" as const;
  return selectedCount === 1 ? "one" as const : "selected" as const;
}
