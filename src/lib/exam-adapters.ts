import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AppData, ExamComponentType, ExamResult } from "@/lib/types";
import { normalizeExamResultScore } from "@/lib/rules";

export const inboundExamResultSchema = z.object({
  sourceSystem: z.enum(["theory_portal", "practical_osce"]),
  sourceAttemptId: z.string().min(1),
  componentType: z.enum(["theory", "practical"]),
  cccuStudentId: z.string().optional(),
  temporaryId: z.string().optional(),
  moduleCode: z.string().min(1),
  termName: z.string().min(1),
  score: z.number().min(0).max(100),
  passMark: z.number().min(0).max(100).default(50),
  takenOn: z.string().min(1)
});

export type InboundExamResult = z.infer<typeof inboundExamResultSchema>;

export interface NormalizedExamResult {
  ok: true;
  result: ExamResult;
}

export interface FailedExamResult {
  ok: false;
  sourceAttemptId?: string;
  reason: string;
}

export interface ExamIngestionSummary {
  accepted: number;
  rejected: number;
  results: Array<NormalizedExamResult | FailedExamResult>;
}

export function normalizeInboundExamResult(input: InboundExamResult, data: AppData): NormalizedExamResult | FailedExamResult {
  const student = data.students.find((candidate) => {
    const cccuMatch = input.cccuStudentId && candidate.cccuStudentId === input.cccuStudentId;
    const tempMatch = input.temporaryId && candidate.temporaryId === input.temporaryId;
    return cccuMatch || tempMatch;
  });
  if (!student) {
    return { ok: false, sourceAttemptId: input.sourceAttemptId, reason: "student_not_found" };
  }

  const courseModule = data.modules.find((candidate) => candidate.code === input.moduleCode);
  if (!courseModule) {
    return { ok: false, sourceAttemptId: input.sourceAttemptId, reason: "module_not_found" };
  }

  const term = data.terms.find((candidate) => candidate.name === input.termName);
  if (!term) {
    return { ok: false, sourceAttemptId: input.sourceAttemptId, reason: "term_not_found" };
  }

  const offering = data.offerings.find(
    (candidate) => candidate.moduleId === courseModule.id && candidate.termId === term.id
  );
  if (!offering) {
    return { ok: false, sourceAttemptId: input.sourceAttemptId, reason: "offering_not_found" };
  }

  const outcome = normalizeExamResultScore(input.score, input.passMark);
  const componentType: ExamComponentType = input.componentType;

  return {
    ok: true,
    result: {
      id: `exam-${input.sourceAttemptId}`,
      studentId: student.id,
      offeringId: offering.id,
      componentType,
      sourceSystem: input.sourceSystem,
      sourceAttemptId: input.sourceAttemptId,
      score: input.score,
      passMark: input.passMark,
      passed: outcome.passed,
      resitRequired: outcome.resitRequired,
      takenOn: input.takenOn,
      importedAt: new Date().toISOString()
    }
  };
}

export function parseExamAdapterPayload(payload: unknown): InboundExamResult[] {
  const arraySchema = z.array(inboundExamResultSchema);
  return arraySchema.parse(payload);
}

export async function persistNormalizedExamResults(
  supabase: SupabaseClient,
  normalized: Array<NormalizedExamResult | FailedExamResult>
): Promise<void> {
  const rows = normalized
    .filter((item): item is NormalizedExamResult => item.ok)
    .map(({ result }) => ({
      student_id: result.studentId,
      offering_id: result.offeringId,
      component_type: result.componentType,
      source_system: result.sourceSystem,
      source_attempt_id: result.sourceAttemptId,
      score: result.score,
      pass_mark: result.passMark,
      passed: result.passed,
      resit_required: result.resitRequired,
      taken_on: result.takenOn,
      imported_at: result.importedAt
    }));

  if (rows.length === 0) {
    return;
  }

  const { error } = await supabase
    .from("exam_results")
    .upsert(rows, { onConflict: "source_system,source_attempt_id" })
    .select("id");
  if (error) {
    throw new Error(error.message);
  }
}

export function summarizeExamIngestion(normalized: Array<NormalizedExamResult | FailedExamResult>): ExamIngestionSummary {
  return {
    accepted: normalized.filter((result) => result.ok).length,
    rejected: normalized.filter((result) => !result.ok).length,
    results: normalized
  };
}
