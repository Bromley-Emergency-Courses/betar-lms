import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AppData, EnrolmentStatus, ExamComponentType, ExamResult } from "@/lib/types";
import { creditsForEnrolmentStatus, normalizeExamResultScore, recommendedOngoingEnrolmentStatus } from "@/lib/rules";

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
  takenOn: z.string().min(1),
  isResit: z.boolean().optional(),
  attemptNumber: z.number().int().positive().optional()
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

interface PracticalCsvImportOptions {
  termName: string;
  takenOn: string;
  passMark: number;
  moduleCodeMap?: Map<string, string>;
}

interface ResolveExamResultInput {
  studentId: string;
  moduleId: string;
  sittingTermId: string;
  componentType: ExamComponentType;
  sourceSystem: "theory_portal" | "practical_osce" | "manual";
  sourceAttemptId: string;
  score: number;
  passMark: number;
  takenOn: string;
  importedAt?: string;
  isResit?: boolean;
  attemptNumber?: number;
}

function csvCell(row: Record<string, unknown>, key: string): string {
  return String(row[key] ?? "").trim();
}

function normalizeModuleCode(value: string): string {
  return value.trim().toUpperCase();
}

function sourceAttemptToken(value: string): string {
  return value.trim().toUpperCase().replace(/[^A-Z0-9._-]+/g, "-");
}

function parseScore(value: string, label: string, rowNumber: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Row ${rowNumber} has an invalid ${label}.`);
  }
  return parsed;
}

export function parsePracticalModuleCodeMap(input: string): Map<string, string> {
  const mappings = new Map<string, string>();
  input
    .split(/\r?\n|,/)
    .map((line) => line.trim())
    .filter(Boolean)
    .forEach((line) => {
      const separator = line.includes("=") ? "=" : line.includes(":") ? ":" : "";
      if (!separator) {
        throw new Error("Module code mappings must use OLD=NEW, one per line.");
      }
      const [source, target, ...extra] = line.split(separator);
      if (extra.length > 0 || !source?.trim() || !target?.trim()) {
        throw new Error("Module code mappings must use OLD=NEW, one per line.");
      }
      mappings.set(normalizeModuleCode(source), normalizeModuleCode(target));
    });
  return mappings;
}

export function practicalCsvRowsToInboundExamResults(
  rows: Array<Record<string, unknown>>,
  options: PracticalCsvImportOptions
): InboundExamResult[] {
  return rows
    .map((row, index) => ({ row, rowNumber: index + 2 }))
    .filter(({ row }) => csvCell(row, "Student ID") || csvCell(row, "Module") || csvCell(row, "Percentage"))
    .map(({ row, rowNumber }) => {
      const cccuStudentId = csvCell(row, "Student ID");
      const sourceModuleCode = normalizeModuleCode(csvCell(row, "Module"));
      const mappedModuleCode = options.moduleCodeMap?.get(sourceModuleCode) ?? sourceModuleCode;
      if (!cccuStudentId) {
        throw new Error(`Row ${rowNumber} is missing Student ID.`);
      }
      if (!sourceModuleCode) {
        throw new Error(`Row ${rowNumber} is missing Module.`);
      }

      const percentage = csvCell(row, "Percentage");
      const score = percentage
        ? parseScore(percentage, "Percentage", rowNumber)
        : (parseScore(csvCell(row, "Total Score"), "Total Score", rowNumber) /
            parseScore(csvCell(row, "Max Score"), "Max Score", rowNumber)) *
          100;
      if (score < 0 || score > 100) {
        throw new Error(`Row ${rowNumber} has a score outside 0-100.`);
      }

      return {
        sourceSystem: "practical_osce",
        sourceAttemptId: [
          "practical",
          sourceAttemptToken(options.termName),
          sourceAttemptToken(mappedModuleCode),
          sourceAttemptToken(cccuStudentId),
          options.takenOn
        ].join(":"),
        componentType: "practical",
        cccuStudentId,
        moduleCode: mappedModuleCode,
        termName: options.termName,
        score: Number(score.toFixed(2)),
        passMark: options.passMark,
        takenOn: options.takenOn
      };
    });
}

function termStartMs(termId: string, data: AppData): number {
  const term = data.terms.find((candidate) => candidate.id === termId);
  return term ? Date.parse(term.startsOn) : Number.NaN;
}

function offeringForEnrolment(enrolmentOfferingId: string, data: AppData) {
  return data.offerings.find((candidate) => candidate.id === enrolmentOfferingId);
}

function latestPriorEnrolmentForModule(input: Pick<ResolveExamResultInput, "studentId" | "moduleId" | "sittingTermId">, data: AppData) {
  const sittingStart = termStartMs(input.sittingTermId, data);
  return data.enrolments
    .map((enrolment) => ({
      enrolment,
      offering: offeringForEnrolment(enrolment.offeringId, data)
    }))
    .filter(({ enrolment, offering }) => {
      if (!offering || enrolment.studentId !== input.studentId || offering.moduleId !== input.moduleId) {
        return false;
      }
      const offeringStart = termStartMs(offering.termId, data);
      return Number.isFinite(sittingStart) && Number.isFinite(offeringStart) && offeringStart < sittingStart;
    })
    .sort((a, b) => termStartMs(b.offering!.termId, data) - termStartMs(a.offering!.termId, data))[0];
}

function sameTermEnrolmentForModule(input: Pick<ResolveExamResultInput, "studentId" | "moduleId" | "sittingTermId">, data: AppData) {
  return data.enrolments
    .map((enrolment) => ({
      enrolment,
      offering: offeringForEnrolment(enrolment.offeringId, data)
    }))
    .find(({ enrolment, offering }) => {
      return (
        enrolment.studentId === input.studentId &&
        offering?.moduleId === input.moduleId &&
        offering.termId === input.sittingTermId
      );
    });
}

function latestPriorFailedResult(input: Pick<ResolveExamResultInput, "studentId" | "componentType" | "sourceAttemptId"> & { offeringId: string }, data: AppData): ExamResult | undefined {
  return data.examResults
    .filter((result) => {
      return (
        result.studentId === input.studentId &&
        result.offeringId === input.offeringId &&
        result.componentType === input.componentType &&
        result.sourceAttemptId !== input.sourceAttemptId &&
        !result.passed
      );
    })
    .sort((a, b) => {
      return (
        (b.attemptNumber ?? 1) - (a.attemptNumber ?? 1) ||
        b.takenOn.localeCompare(a.takenOn) ||
        b.importedAt.localeCompare(a.importedAt)
      );
    })[0];
}

export function resolveExamResultForStudent(input: ResolveExamResultInput, data: AppData): NormalizedExamResult | FailedExamResult {
  const sameTerm = sameTermEnrolmentForModule(input, data);
  const prior = sameTerm ? undefined : latestPriorEnrolmentForModule(input, data);
  const target = sameTerm ?? prior;
  if (!target?.offering) {
    return { ok: false, sourceAttemptId: input.sourceAttemptId, reason: "offering_not_found" };
  }

  const inferredResit = !sameTerm;
  const isResit = input.isResit ?? inferredResit;
  const priorFailedResult = isResit
    ? latestPriorFailedResult(
        {
          studentId: input.studentId,
          offeringId: target.offering.id,
          componentType: input.componentType,
          sourceAttemptId: input.sourceAttemptId
        },
        data
      )
    : undefined;
  const attemptNumber = input.attemptNumber ?? (isResit ? Math.max(2, (priorFailedResult?.attemptNumber ?? 1) + 1) : 1);
  const outcome = normalizeExamResultScore(input.score, input.passMark);

  return {
    ok: true,
    result: {
      id: `exam-${input.sourceAttemptId}`,
      studentId: input.studentId,
      offeringId: target.offering.id,
      componentType: input.componentType,
      sourceSystem: input.sourceSystem,
      sourceAttemptId: input.sourceAttemptId,
      score: input.score,
      passMark: input.passMark,
      passed: outcome.passed,
      resitRequired: outcome.resitRequired,
      isResit,
      attemptNumber,
      resitOfResultId: priorFailedResult?.id,
      priorAttemptMissing: isResit && !priorFailedResult,
      takenOn: input.takenOn,
      importedAt: input.importedAt ?? new Date().toISOString()
    }
  };
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

  return resolveExamResultForStudent({
    studentId: student.id,
    moduleId: courseModule.id,
    sittingTermId: term.id,
    componentType: input.componentType,
    sourceSystem: input.sourceSystem,
    sourceAttemptId: input.sourceAttemptId,
    score: input.score,
    passMark: input.passMark,
    takenOn: input.takenOn,
    isResit: input.isResit,
    attemptNumber: input.attemptNumber
  }, data);
}

export function parseExamAdapterPayload(payload: unknown): InboundExamResult[] {
  const arraySchema = z.array(inboundExamResultSchema);
  return arraySchema.parse(payload);
}

export async function persistNormalizedExamResults(
  supabase: SupabaseClient,
  normalized: Array<NormalizedExamResult | FailedExamResult>
): Promise<ExamResult[]> {
  const acceptedResults = normalized.filter((item): item is NormalizedExamResult => item.ok).map(({ result }) => result);
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
      is_resit: result.isResit,
      attempt_number: result.attemptNumber,
      resit_of_result_id: result.resitOfResultId ?? null,
      prior_attempt_missing: result.priorAttemptMissing,
      taken_on: result.takenOn,
      imported_at: result.importedAt
    }));

  if (rows.length === 0) {
    return [];
  }

  const { error } = await supabase
    .from("exam_results")
    .upsert(rows, { onConflict: "source_system,source_attempt_id" })
    .select("id");
  if (error) {
    throw new Error(error.message);
  }

  return acceptedResults;
}

export interface EnrolmentStatusUpdate {
  enrolmentId: string;
  studentId: string;
  status: EnrolmentStatus;
  creditsAwarded: number;
}

export async function syncEnrolmentStatusesForExamResults(
  supabase: SupabaseClient,
  data: AppData,
  incomingResults: ExamResult[]
): Promise<EnrolmentStatusUpdate[]> {
  if (incomingResults.length === 0) {
    return [];
  }

  const incomingSourceAttemptIds = new Set(incomingResults.map((result) => `${result.sourceSystem}:${result.sourceAttemptId}`));
  const nextData: AppData = {
    ...data,
    examResults: [
      ...data.examResults.filter((result) => !incomingSourceAttemptIds.has(`${result.sourceSystem}:${result.sourceAttemptId}`)),
      ...incomingResults
    ]
  };
  const affectedKeys = new Set(incomingResults.map((result) => `${result.studentId}:${result.offeringId}`));
  const updates: EnrolmentStatusUpdate[] = [];

  for (const enrolment of nextData.enrolments) {
    if (!affectedKeys.has(`${enrolment.studentId}:${enrolment.offeringId}`)) {
      continue;
    }

    const status = recommendedOngoingEnrolmentStatus(enrolment, nextData);
    if (!status || status === enrolment.status) {
      continue;
    }

    const offering = nextData.offerings.find((candidate) => candidate.id === enrolment.offeringId);
    if (!offering) {
      continue;
    }
    const creditsAwarded = creditsForEnrolmentStatus(status, offering, nextData);
    const { error } = await supabase
      .from("enrolments")
      .update({
        status,
        credits_awarded: creditsAwarded
      })
      .eq("id", enrolment.id);
    if (error) {
      throw new Error(error.message);
    }

    updates.push({
      enrolmentId: enrolment.id,
      studentId: enrolment.studentId,
      status,
      creditsAwarded
    });
  }

  return updates;
}

export function summarizeExamIngestion(normalized: Array<NormalizedExamResult | FailedExamResult>): ExamIngestionSummary {
  return {
    accepted: normalized.filter((result) => result.ok).length,
    rejected: normalized.filter((result) => !result.ok).length,
    results: normalized
  };
}
