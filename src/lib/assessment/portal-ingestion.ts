import "server-only";
import { ingestAssessmentSource, readAssessmentTable } from "./index";
import { portalAssessmentSource } from "./adapters";
import type { AssessmentIngestionSummary, AssessmentSource, AssessmentSourceInput } from "./types";

interface PortalResult {
  token_id: string; student_name: string; completed_at: string; percentage: number; lms_student_id?: string | null; token?: string | null;
}

export async function ingestPortalAssessmentResults(mapping: { portal_exam_id: string; module_id: string | null; term_id: string; portal_exam_kind: string; physics_required: boolean }, results: PortalResult[], reason: string): Promise<AssessmentIngestionSummary> {
  const existing = await readAssessmentTable<AssessmentSource>("assessment_import_reconciliation");
  const physics = existing.filter(source => source.payload.sitting_term_id === mapping.term_id && source.payload.items?.some(item => item.kind === "physics") && !source.payload.items?.some(item => item.kind === "mcq"));
  const batch: AssessmentSourceInput[] = results.map(result => {
    const identifier = result.lms_student_id?.trim() || result.student_name.match(/(?:^|\D)(\d{9})(?:\D|$)/)?.[1] || `unresolved:${result.token_id}`;
    const input = portalAssessmentSource({ examId: mapping.portal_exam_id, tokenId: result.token_id, studentIdentifier: identifier,
      studentName: result.student_name, moduleId: mapping.module_id, sittingDate: result.completed_at.slice(0,10), sittingTermId: mapping.term_id,
      mcq: result.percentage, rawPayload: result, reason });
    if (mapping.portal_exam_kind === "physics_equipment") return { ...input, module_id: null, items: [{kind:"physics",score:result.percentage}] };
    if (mapping.physics_required) {
      const candidates = physics.filter(source => source.student_identifier === identifier && source.payload.sitting_date === input.sitting_date && source.state === "Unmatched" && !source.identity_override_reason);
      if (candidates.length === 1) {
        input.items?.push({kind:"physics",score:candidates[0].payload.items?.find(item=>item.kind==="physics")?.score});
        input.raw_payload = { submission:result, physics_source_key:candidates[0].source_key, physics_payload:candidates[0].payload };
      }
    }
    return input;
  });
  const summary = await ingestAssessmentSource(batch);
  if (mapping.portal_exam_kind === "physics_equipment" && summary.rejected === 0 && summary.source_updated > 0) {
    const linkedTheory: AssessmentSourceInput[] = [];
    for (const source of existing) {
      const evidence = source.payload.raw_payload as {physics_source_key?:string;submission?:unknown;physics_payload?:unknown} | null;
      const refreshed = batch.find(input=>input.source_key===evidence?.physics_source_key);
      const originalPhysics = physics.find(candidate=>candidate.source_key===refreshed?.source_key);
      if (!refreshed || !evidence || originalPhysics?.state !== "Unmatched"
        || refreshed.student_identifier !== originalPhysics.student_identifier
        || refreshed.sitting_date !== source.payload.sitting_date
        || refreshed.items?.[0].score === originalPhysics.payload.items?.[0].score) continue;
      linkedTheory.push({...source.payload,reason,items:source.payload.items?.map(item=>item.kind==="physics"?{kind:"physics",score:refreshed.items?.[0].score}:item),
        raw_payload:{...evidence,physics_payload:refreshed}});
    }
    if (linkedTheory.length) {
      const updates=await ingestAssessmentSource(linkedTheory);
      for (const key of ["created","unchanged","source_updated","auto_matched","unmatched","rejected"] as const) summary[key]+=updates[key];
      summary.errors.push(...updates.errors);
    }
  }
  return summary;
}
