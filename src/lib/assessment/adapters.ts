import { z } from "zod";
import type { AppData } from "@/lib/types";
import { practicalCsvRowsToInboundExamResults, type InboundExamResult } from "@/lib/exam-adapters";
import type { AssessmentSourceInput } from "./types";

const percentage = z.number().finite().min(0).max(100);

export function inboundAssessmentSource(result: InboundExamResult, data: AppData, reason: string, rawPayload: unknown = result): AssessmentSourceInput {
  const rawRow=rawPayload && typeof rawPayload==="object" ? rawPayload as Record<string,unknown> : {};
  return {
    source_system: result.sourceSystem === "theory_portal" ? "Portal" : "Practical CSV",
    source_key: result.sourceAttemptId,
    known_resit: Boolean(result.isResit || (result.attemptNumber ?? 1)>1 || Number(rawRow["Attempt Number"])>1 || ["yes","true","1"].includes(String(rawRow["Is Resit"]).toLowerCase())),
    student_identifier: result.cccuStudentId || result.temporaryId || "",
    module_id: data.modules.find((module) => module.code === result.moduleCode)?.id ?? null,
    component: result.componentType,
    score: percentage.parse(result.score), pass_mark: percentage.parse(result.passMark),
    sitting_date: z.iso.date().parse(result.takenOn),
    sitting_term_id: data.terms.find((term) => term.name === result.termName)?.id,
    items: result.componentType === "theory" ? [{ kind: "mcq", score: result.score }] : [],
    raw_payload: rawPayload, reason
  };
}

export function portalAssessmentSource(input: {
  examId: string; tokenId: string; studentIdentifier: string; studentName: string;
  moduleId: string | null; sittingDate: string; sittingTermId: string; mcq: number;
  physics?: { score: number; sourceKey: string }; rawPayload: unknown; reason: string;
}): AssessmentSourceInput {
  const mcq = percentage.parse(input.mcq);
  const physics = input.physics ? percentage.parse(input.physics.score) : undefined;
  return {
    source_system: "Portal", source_key: `${input.examId}:${input.tokenId}`,
    student_identifier: input.studentIdentifier, student_name: input.studentName,
    module_id: input.moduleId, component: "theory", sitting_date: z.iso.date().parse(input.sittingDate), sitting_term_id: input.sittingTermId,
    items: [{ kind: "mcq", score: mcq }, ...(physics === undefined ? [] : [{ kind: "physics" as const, score: physics }])],
    raw_payload: { submission: input.rawPayload, physics_source_key: input.physics?.sourceKey ?? null }, reason: input.reason
  };
}

export function practicalAssessmentSources(rows: Record<string,unknown>[], data: AppData, options: {termName:string;takenOn:string;passMark:number;moduleCodeMap:Map<string,string>;reason:string}) {
  const sources:AssessmentSourceInput[]=[];
  const rejected:Array<{source_key:string;error:string}>=[];
  rows.forEach((row,index)=>{
    try {
      const parsed=practicalCsvRowsToInboundExamResults([row],options);
      if (!parsed.length) throw new Error("Missing practical result fields.");
      sources.push(inboundAssessmentSource(parsed[0],data,options.reason,row));
    } catch(error) {
      rejected.push({source_key:`CSV row ${index+2}`,error:error instanceof Error?error.message:"Invalid CSV row"});
    }
  });
  return {sources,rejected};
}
