import { z } from "zod";
import type { AssessmentEvaluation } from "./assessment/types";

export interface EnrolmentOffering {
  id: string; label: string; mode: "online" | "practical"; planId: string | null; ready: boolean;
  firstDays: number; subsequentDays: number; presentationRequired: boolean; token: string;
}
export interface WorkspaceEnrolment {
  id: string; offeringId: string; offering: EnrolmentOffering; revision: number; token: string;
  attendanceDays: number | null; presentationRequired: boolean | null; assessment: AssessmentEvaluation | null; removalReasons: string[];
  cancellationReasons: string[];
  cancellation: { reason: string; createdAt: string; actorName: string } | null;
}
export interface EnrolmentWorkspace { enrolments: WorkspaceEnrolment[]; offerings: EnrolmentOffering[] }

const base = { enrolment_id: z.uuid(), student_id: z.uuid(), reason: z.string().trim().min(1, "Enter an administrator reason.").max(4000) };
const existing = { ...base, expected_token: z.string().regex(/^[a-f0-9]{32}$/) };
const requirements = { attendance_days: z.number().int().min(0).max(2147483647).nullable(), presentation_required: z.boolean().nullable() };
export const enrolmentCommandSchema = z.strictObject({
  expectedRevision: z.number().int().nonnegative(),
  command: z.discriminatedUnion("type", [
    z.strictObject({ ...base, ...requirements, type: z.literal("CreateModuleEnrolment"), offering_id: z.uuid(), offering_token: z.string().regex(/^[a-f0-9]{32}$/) }),
    z.strictObject({ ...existing, ...requirements, type: z.literal("SetEnrolmentRequirements") }),
    z.strictObject({ ...existing, type: z.literal("SetEnrolmentDisposition"), disposition: z.enum(["Abandoned", "Module deferred"]) }),
    z.strictObject({ ...existing, type: z.literal("ClearEnrolmentDisposition") }),
    z.strictObject({ ...existing, type: z.literal("CancelMistakenEnrolment"), confirmed: z.literal(true) })
  ])
});
