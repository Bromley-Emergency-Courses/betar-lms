import { z } from "zod";
import { presentationRubricCriteria } from "./presentation-rubric";
import type { AssessmentDomain } from "./types";

export type TeachingKind = "observation" | "formative" | "presentation";
export const teachingKindLabels = { observation: "Observation", formative: "Formative assessment", presentation: "Presentation" };
export interface TeachingOptions {
  offerings: Array<{ id: string; moduleId: string; termId: string; label: string; token: string }>;
  definitions: Array<{ id: string; moduleId: string; name: string; domains: AssessmentDomain[]; scoreMin: number; scoreMax: number; token: string }>;
}
const token = z.string().regex(/^[a-f0-9]{32}$/);
const base = { id: z.uuid(), student_id: z.uuid(), offering_id: z.uuid(), offering_token: token, occurred_on: z.iso.date() };
const comments = z.string().trim().max(10000).nullable();
const rubric = z.record(z.string(), z.number().int().min(1).max(5)).refine(scores => Object.keys(scores).length === presentationRubricCriteria.length && presentationRubricCriteria.every(criterion => Object.hasOwn(scores, criterion.id)), "Score every presentation rubric criterion.");
export const teachingCommandSchema = z.discriminatedUnion("kind", [
  z.strictObject({ ...base, kind: z.literal("observation"), summary: z.string().trim().min(1, "Enter observation details.").max(10000), concern_level: z.enum(["none", "watch", "support_needed"]) }),
  z.strictObject({ ...base, kind: z.literal("formative"), definition_id: z.uuid(), definition_token: token, assessed_item_ids: z.array(z.string().min(1)).min(1, "Select at least one assessed item.").refine(items => new Set(items).size === items.length, "Select each assessed item once."), overall_score: z.number().int(), comments }),
  z.strictObject({ ...base, kind: z.literal("presentation"), presentation_type: z.enum(["case_presentation", "journal_club"]), duration_minutes: z.number().int().positive().max(2147483647), scores: rubric, comments })
]);
