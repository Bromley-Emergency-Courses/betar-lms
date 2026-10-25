export type AssessmentComponent = "theory" | "practical";
export type AssessmentStatus = "Planned" | "In progress" | "Abandoned" | "Pass" | "Fail" | "Module deferred" | "Assessment deferred";
export type AssessmentItemKind = "mcq" | "physics" | "coursework" | "viva";
export interface AssessmentItemInput { kind: AssessmentItemKind; score?: number; carried_from_item_id?: string }
export interface AssessmentPlan {
  id: string; module_id: string; version: number; mode: "online" | "practical";
  theory_scheme: "mcq" | "coursework_viva"; requires_coursework: boolean; requires_viva: boolean;
  physics_weighting: boolean; theory_pass_mark: number; practical_pass_mark: number | null;
}
export interface AssessmentScoreInput {
  score?: number; pass_mark?: number; sitting_date: string; sitting_term_id?: string;
  items: AssessmentItemInput[]; previous_result_unavailable?: string;
}
type CommandBase = { enrolment_id: string; reason: string };
type SourceCommand = { source_id: string; expected_source_revision: number; identity_override_reason?: string; previous_result_unavailable?: string };
export type AssessmentCommand = CommandBase & (
  | { type: "CreateModuleEnrolment"; student_id: string; offering_id: string; offering_token: string; attendance_days: number | null; presentation_required: boolean | null }
  | { type: "SetEnrolmentRequirements"; student_id: string; expected_token: string; attendance_days: number | null; presentation_required: boolean | null }
  | { type: "RemoveModuleEnrolment"; student_id: string; expected_token: string; confirmed: true }
  | { type: "CancelMistakenEnrolment"; student_id: string; expected_token: string; confirmed: true }
  | ({ type: "AddManualAttempt"; component: AssessmentComponent } & AssessmentScoreInput)
  | ({ type: "CorrectManualAttempt"; attempt_id: string } & AssessmentScoreInput)
  | { type: "CorrectImportedAttempt"; attempt_id: string; source_id: string; expected_source_revision: number; score?: number; items: AssessmentItemInput[] }
  | { type: "ExcludeAttempt"; attempt_id: string; category: "invalid" | "incorrect_ownership"; expected_source_revision?: number }
  | { type: "RestoreAttempt"; attempt_id: string; exclusion_id: string; expected_source_revision?: number; reviewed_source_version_id?: string }
  | ({ type: "MatchSourceResult" | "UnmatchSourceResult" | "VoidSourceResult" | "RestoreSourceResult" } & SourceCommand)
  | ({ type: "ReplaceSourceResult"; component: AssessmentComponent } & SourceCommand & AssessmentScoreInput)
  | { type: "ScheduleResit" | "CancelResit" | "DeferAssessment" | "ClearAssessmentDeferral"; component: AssessmentComponent; note?: string }
  | { type: "SetEnrolmentDisposition"; disposition: "Abandoned" | "Module deferred" }
  | { type: "ClearEnrolmentDisposition" }
  | { type: "SetAssessmentOverride" | "ClearAssessmentOverride"; kind: "status" | "indicator" | "credits"; indicator?: string; value?: AssessmentStatus | boolean | number }
  | { type: "ChangeEnrolmentAssessmentPlan"; plan_id: string; preview: unknown }
);
export interface ComponentResult {
  component: AssessmentComponent; id: string | null; sequence: number | null; score: number | null;
  pass_mark: number | null; passed: boolean | null; origin: string | null; revision: number | null;
  attempt_count: number; arrangement_kind: "resit_schedule" | "assessment_deferral" | null;
  arrangement_state: "active" | "completed" | "cancelled" | null; note: string | null;
}
export interface AssessmentEvaluation {
  enrolment_id: string; revision: number; needs_plan?: boolean; plan: AssessmentPlan;
  student_id: string; module_id: string; original_term_id: string;
  components: { theory: ComponentResult; practical?: ComponentResult };
  calculated_status: AssessmentStatus; effective_status: AssessmentStatus;
  calculated_indicators: string[]; effective_indicators: string[];
  calculated_credits: number; recommended_credits: number; awarded_credits: number;
  overrides: Array<{ kind: "status" | "indicator" | "credits"; indicator: string; value: string | number | boolean; reason: string }>;
  disposition: string | null; attendance_required: number; attendance_actual: number; presentation_pending: boolean;
  pass_reversed?: boolean;
}
export interface AssessmentPlanPreview {
  before: AssessmentEvaluation;
  after: AssessmentEvaluation;
  incompatible_attempts: string[];
  attempts: Array<{ id: string; component: AssessmentComponent }>;
}
export interface AssessmentSourceInput extends Partial<AssessmentScoreInput> {
  known_resit?: boolean;
  source_system: "Portal" | "Practical CSV"; source_key: string; student_identifier: string; student_name?: string;
  module_id: string | null; component: AssessmentComponent; sitting_date: string; raw_payload: unknown; reason: string;
}
export interface AssessmentIngestionSummary {
  created: number; unchanged: number; source_updated: number; auto_matched: number; unmatched: number; rejected: number;
  errors: Array<{ source_key: string; error: string }>;
}
export interface AssessmentChangeSummary { assessment: AssessmentEvaluation | null; source_id: string | null; pass_reversed: boolean; change?: { before_status: AssessmentStatus; after_status: AssessmentStatus; before_credits: number; after_credits: number } }
export interface AssessmentSourceEvidence {
  id: string; revision: number; state: string; source_system: string; source_key: string; conflict: string | null;
  versions: Array<{ id: string; revision: number; observed_at: string; student_identifier: string; component: string; sitting_date: string; score: number | null; pass_mark: number | null; items: AssessmentItemInput[] }>;
}
export interface AssessmentOutcome {
  temporary_identifier?: string;
  enrolment_id: string; student_id: string; student_identifier: string; student_name: string; module_code: string; module_title: string;
  original_cohort: string; assessment: AssessmentEvaluation; legacy_status: string; legacy_final_mark: number | null; legacy_grade: string | null; legacy_credits: number;
}
export interface AssessmentAttempt {
  lifecycle?: AssessmentAttemptEvent[];
  id: string; enrolment_id: string; component: AssessmentComponent; ordinal: number; sequence: number | null;
  previous_result_unavailable: string | null; origin: string; source_id: string | null; active: boolean;
  revision: number; revision_id: string; score: number; pass_mark: number; passed: boolean; sitting_date: string;
  sitting_term: string | null; sitting_term_id: string | null; is_current: boolean; reason: string;
  items: Array<AssessmentItemInput & { id: string; score: number }>;
}
export interface AssessmentAttemptEvent {
  id: string; attempt_id: string; attempt_revision_id: string; kind: "exclude" | "restore"; category: "invalid" | "incorrect_ownership";
  exclusion_id: string | null; source_version_id: string | null; reason: string; created_at: string; event_order: number; actor_id: string; actor_name: string;
}
export interface AssessmentSource {
  module_code?: string; module_title?: string;
  id: string; source_system: string; source_key: string; student_identifier: string; student_name: string;
  module_id: string | null; component: AssessmentComponent; state: "Matched" | "Unmatched" | "Replaced manually" | "Voided";
  revision: number; identity_override_reason: string | null; conflict: string | null;
  payload: AssessmentSourceInput; enrolment_id: string | null; attempt_id: string | null; replacement_agrees: boolean | null;
}

export interface AssessmentRevision {
  id: string;
  attempt_id: string;
  revision: number;
  score: number;
  pass_mark: number;
  passed: boolean;
  sitting_date: string;
  reason: string;
  created_at: string;
  source_version_id: string | null;
  items: AssessmentAttempt["items"];
}

export interface AssessmentDecision {
  id: string; enrolment_id: string; kind: "status" | "credits" | "indicator"; indicator: string;
  value: string | number | boolean | null; reason: string; created_at: string; event_order: number;
  actor_id: string; actor_name: string;
}
