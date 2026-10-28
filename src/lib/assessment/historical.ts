import type { AssessmentOutcome, AssessmentStatus, ComponentResult, HistoricalAssessmentResult } from "./types";

const statuses: Record<string, AssessmentStatus> = { completed: "Pass", failed: "Fail", planned: "Planned", in_progress: "In progress" };

export function historicalStatusLabel(status: string): string {
  return status.replaceAll("_", " ");
}

export function historicalComponent(results: HistoricalAssessmentResult[], component: "theory" | "practical"): ComponentResult {
  const rows = results.filter(row => row.component === component).sort((first, second) => second.taken_on.localeCompare(first.taken_on) || second.attempt_number - first.attempt_number);
  const latest = rows[0];
  const ambiguous = latest && rows.some(row => row.id !== latest.id && row.taken_on === latest.taken_on && row.attempt_number === latest.attempt_number);
  return {
    component, id: null, sequence: null, score: ambiguous ? null : latest?.score ?? null,
    pass_mark: ambiguous ? null : latest?.pass_mark ?? null, passed: ambiguous ? null : latest?.passed ?? null,
    origin: "Historical record", revision: null, attempt_count: rows.length,
    arrangement_kind: null, arrangement_state: null, note: null
  };
}

export function retainHistoricalOutcomes(outcomes: AssessmentOutcome[], results: HistoricalAssessmentResult[]): AssessmentOutcome[] {
  return outcomes.map(outcome => {
    if (outcome.assessment.activation) return outcome;
    const recorded = results.filter(row => row.enrolment_id === outcome.enrolment_id);
    const unreviewed = recorded.filter(row => !row.reviewed_backfill);
    const hasModernEvidence = Object.values(outcome.assessment.components ?? {}).some(component => component?.attempt_count) || outcome.assessment.overrides?.length || outcome.assessment.disposition;
    const recordedOutcomeWithoutResults = !recorded.length && !hasModernEvidence && (outcome.legacy_status !== "planned" || outcome.legacy_credits !== 0 || outcome.legacy_final_mark !== null || outcome.legacy_grade !== null);
    if (!outcome.assessment.historical?.protected && !outcome.assessment.needs_plan && !unreviewed.length && !recordedOutcomeWithoutResults) return outcome;
    const theory = historicalComponent(recorded, "theory");
    const practical = historicalComponent(recorded, "practical");
    const flags = new Set<string>();
    if (unreviewed.length) flags.add("Historical results retained — reconciliation required");
    if (!statuses[outcome.legacy_status]) flags.add("Historical status requires review");
    if (outcome.legacy_status === "failed" || outcome.legacy_status === "resit" || theory.passed === false || practical.passed === false) flags.add("Historical failure / resit requires review");
    if (recorded.some(row => row.prior_attempt_missing || ((row.is_resit || row.attempt_number > 1) && !row.resit_of_result_id))) flags.add("Earlier attempt reference requires review");
    if (recorded.some(row => row.passed !== (row.score >= row.pass_mark) || row.resit_required === row.passed)) flags.add("Recorded result flags require review");
    if ((theory.attempt_count && theory.score === null) || (practical.attempt_count && practical.score === null)) flags.add("Latest historical result is ambiguous — see all records");
    if (outcome.legacy_status !== "completed" && outcome.legacy_credits !== 0) flags.add("Recorded credits require review");
    if (outcome.legacy_status === "completed" && outcome.module_credits !== undefined && outcome.legacy_credits !== outcome.module_credits) flags.add("Recorded credits differ from current module credits");
    if (outcome.legacy_status === "completed" && theory.passed !== true) flags.add("Recorded completion differs from available Theory evidence");
    if (outcome.assessment.historical?.protected) return { ...outcome, assessment: {
      ...outcome.assessment,
      historical: { ...outcome.assessment.historical, review_flags: [...flags] },
      components: unreviewed.length || !Object.keys(outcome.assessment.components ?? {}).length ? { theory, practical } : outcome.assessment.components
    } };
    return { ...outcome, assessment: {
      ...outcome.assessment,
      historical: { status: outcome.legacy_status, final_mark: outcome.legacy_final_mark, grade: outcome.legacy_grade, review_flags: [...flags] },
      original_term_id: outcome.original_term_id ?? recorded[0]?.original_term_id ?? outcome.assessment.original_term_id,
      components: { theory, practical }, effective_status: statuses[outcome.legacy_status] ?? "Historical",
      calculated_status: "Historical", effective_indicators: [...flags].filter(flag => flag === "Historical failure / resit requires review"), calculated_indicators: [],
      awarded_credits: outcome.legacy_credits, overrides: []
    } };
  });
}
