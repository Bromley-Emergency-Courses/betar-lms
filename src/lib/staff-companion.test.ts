import { describe, expect, it } from "vitest";
import { componentScoreText } from "./assessment/display";
import type { AssessmentSummary } from "./assessment";
import { attachRecordedPresentations, attendanceLabel, companionHref, companionScreen, companionQuerySchema, isHereToday, moduleResult, recordedAttendanceDays, studentDays, teachingDate, termAttendance, type CompanionModuleResult } from "./staff-companion";

const enrolment = { id: "enrolment", student_id: "student", offering_id: "offering", presentation_required_override: null };
const offering = { id: "offering", term_id: "term", module_id: "module", presentation_required: true };
const courseModule = { id: "module", code: "VA", title: "Vascular access" };
const term = { id: "term", name: "Autumn", status: "active", starts_on: "2026-09-01" };
const outcome = { assessment: { plan: { mode: "practical" }, components: { theory: { score: 0 }, practical: { score: null } }, effective_status: "Fail", effective_indicators: ["Theory Resit required"], attendance_actual: 4, attendance_required: 5, presentation_pending: false } } as AssessmentSummary;
const result = () => moduleResult(enrolment, offering, courseModule, term, outcome);

describe("staff companion read projection", () => {
  it("shows retained historical exam results and outcomes without requiring a new assessment plan", () => {
    const historical = { ...outcome, assessment: { ...outcome.assessment, plan: undefined, needs_plan: true,
      effective_status: "Pass", effective_indicators: [],
      historical: { protected: true, status: "completed", credits: 10, final_mark: null, grade: null, review_flags: [] },
      components: { theory: { score: 72, origin: "Historical record", attempt_count: 1 }, practical: { score: 0, origin: "Historical record", attempt_count: 1 } }
    } } as unknown as AssessmentSummary;
    expect(moduleResult(enrolment, offering, courseModule, term, historical)).toMatchObject({ status: "Pass", theory: "72% (recorded)", practical: "0% (recorded)", risk: [] });
  });
  it("distinguishes no recorded exam from unavailable data on protected ongoing enrolments", () => {
    const ongoing = { ...outcome, assessment: { ...outcome.assessment, plan: undefined, needs_plan: true,
      effective_status: "In progress", effective_indicators: [],
      historical: { protected: true, current_term_in_progress: true, status: "planned", credits: 10, final_mark: null, grade: null, review_flags: [] },
      components: { theory: { score: null, origin: "Historical record", attempt_count: 0 }, practical: { score: null, origin: "Historical record", attempt_count: 0 } }
    } } as unknown as AssessmentSummary;
    expect(moduleResult(enrolment, offering, courseModule, term, ongoing)).toMatchObject({ status: "In progress", theory: "Not recorded", practical: "Not recorded", attended: null, required: null });
  });
  it("does not hide historical Practical evidence when a reviewed plan is online", () => {
    const historical = { ...outcome, assessment: { ...outcome.assessment, plan: { ...outcome.assessment.plan, mode: "online" },
      historical: { protected: true, status: "completed", final_mark: null, grade: null, review_flags: [] },
      components: { ...outcome.assessment.components, practical: { ...outcome.assessment.components.practical!, score: 65, origin: "Historical record", attempt_count: 1 } }
    } } as AssessmentSummary;
    expect(moduleResult(enrolment, offering, courseModule, term, historical).practical).toBe("65% (recorded)");
    historical.assessment.components.practical!.score = null;
    expect(moduleResult(enrolment, offering, courseModule, term, historical).practical).toBe("Review result history");
    historical.assessment.components.practical!.attempt_count = 0;
    expect(moduleResult(enrolment, offering, courseModule, term, historical).practical).toBe("N/A");
  });
  it("keeps protected Fail and explicit warning flags visible without inferring historical teaching failures", () => {
    const historical = { ...outcome, assessment: { ...outcome.assessment, needs_plan: true,
      historical: { protected: true, status: "failed", final_mark: null, grade: null, review_flags: ["Administrative review"] },
      effective_indicators: ["Presentation incomplete"], presentation_pending: true
    } } as AssessmentSummary;
    expect(moduleResult(enrolment, offering, courseModule, term, historical)).toMatchObject({ status: "Fail", risk: ["Module failed", "Presentation incomplete"], presentation: "Unavailable", attended: null });
    const passed = { ...historical, assessment: { ...historical.assessment, effective_status: "Pass" as const, effective_indicators: [] } };
    expect(moduleResult(enrolment, offering, courseModule, term, passed).risk).toEqual([]);
  });
  it("keeps existing student links working and validates explicit destinations", () => {
    const studentId = "62000000-0000-4000-8000-000000000001";
    expect(companionScreen(companionQuerySchema.parse({}))).toBe("overview");
    expect(companionScreen(companionQuerySchema.parse({ studentId }))).toBe("student");
    expect(companionScreen(companionQuerySchema.parse({ studentId, screen: "overview" }))).toBe("overview");
    expect(companionScreen(companionQuerySchema.parse({ screen: "entry" }))).toBe("entry");
    expect(companionScreen(companionQuerySchema.parse({ screen: "invalid" }))).toBe("overview");
  });
  it("retains the selected student and roster filters across teaching destinations", () => {
    const query = companionQuerySchema.parse({ studentId: "62000000-0000-4000-8000-000000000001", mode: "term", q: "Alex & Sam", filter: "here", page: 2 });
    const url = new URL(companionHref(query, { screen: "overview" }), "http://localhost");
    expect(url.searchParams.get("studentId")).toBe(query.studentId);
    expect(url.searchParams.get("q")).toBe("Alex & Sam");
    expect(url.searchParams.get("filter")).toBe("here");
    expect(url.searchParams.get("page")).toBe("2");
    expect(new URL(companionHref(query, { screen: "entry", studentId: undefined }), "http://localhost").searchParams.has("studentId")).toBe(false);
  });
  it("uses the same zero, pending and not-applicable formatting as the profile", () => {
    expect(componentScoreText({ score: 0 })).toBe("0%");
    expect(componentScoreText({ score: null })).toBe("Pending");
    expect(componentScoreText(undefined, true)).toBe("N/A");
    expect(result()).toMatchObject({ theory: "0%", practical: "Pending", status: "Fail", presentation: "Complete" });
  });
  it("does not infer marks or attendance from an unreviewed or unavailable plan", () => {
    expect(moduleResult(enrolment, offering, courseModule, term)).toMatchObject({ theory: "Unavailable", practical: "Unavailable", attended: null, presentation: "Unavailable" });
    const unreviewed = { ...outcome, assessment: { ...outcome.assessment, needs_plan: true } };
    expect(moduleResult(enrolment, offering, courseModule, term, unreviewed)).toMatchObject({ status: "Plan review required", theory: "Unavailable", attended: null });
  });
  it("respects individual presentation exceptions and canonical carried completion", () => {
    expect(moduleResult({ ...enrolment, presentation_required_override: false }, offering, courseModule, term, outcome).presentation).toBe("N/A");
    expect(result().presentation).toBe("Complete");
    expect(moduleResult(enrolment, offering, courseModule, term, { ...outcome, assessment: { ...outcome.assessment, presentation_pending: true } }).presentation).toBe("Incomplete");
  });
  it("does not multiply term totals across modules or fabricate unknown requirements", () => {
    expect(termAttendance([result(), result()])).toEqual({ attended: 4, required: 5 });
    expect(termAttendance([{ ...result(), practicalModule: null }])).toEqual({ attended: null, required: null });
    expect(termAttendance([{ ...result(), practicalModule: false }])).toEqual({ attended: 0, required: 0 });
    expect(termAttendance([])).toEqual({ attended: null, required: null });
  });
  it("uses effective current outcomes, not old attempts or an operational planning gap", () => {
    const passed = { ...outcome, assessment: { ...outcome.assessment, effective_status: "Pass" as const, effective_indicators: [] } };
    expect(moduleResult(enrolment, offering, courseModule, term, passed).risk).toEqual([]);
    expect(result().risk).toContain("Theory Resit required");
    for (const status of ["Abandoned", "Module deferred", "Assessment deferred"] as const) {
      expect(moduleResult(enrolment, offering, courseModule, term, { ...outcome, assessment: { ...outcome.assessment, effective_status: status } }).risk).toEqual([]);
    }
  });
  it.each(["Attendance non-compliance", "Presentation incomplete"])("does not describe %s as a failed assessment score", indicator => {
    const nonAssessmentFailure = { ...outcome, assessment: { ...outcome.assessment,
      components: { theory: { ...outcome.assessment.components.theory, score: 75, passed: true }, practical: { ...outcome.assessment.components.practical!, score: 80, passed: true } },
      effective_indicators: [indicator]
    } };
    const projection = moduleResult(enrolment, offering, courseModule, term, nonAssessmentFailure);
    expect(projection).toMatchObject({ status: "Fail", theory: "75%", practical: "80%" });
    expect(projection.risk).toEqual(["Module failed", indicator]);
  });
  it("preserves an overridden Fail without inventing a component failure", () => {
    const overridden = { ...outcome, assessment: { ...outcome.assessment,
      components: { theory: { ...outcome.assessment.components.theory, score: 75, passed: true }, practical: { ...outcome.assessment.components.practical!, score: 80, passed: true } },
      effective_indicators: [], overrides: [{ kind: "status" as const, indicator: "", value: "Fail", reason: "Reviewed module decision" }]
    } };
    expect(moduleResult(enrolment, offering, courseModule, term, overridden)).toMatchObject({ status: "Fail", risk: ["Module failed"] });
  });
  it("separates online N/A from practical Pending and keeps original term ownership", () => {
    expect(moduleResult(enrolment, offering, courseModule, term, { ...outcome, assessment: { ...outcome.assessment, plan: { ...outcome.assessment.plan, mode: "online" } } })).toMatchObject({ practical: "N/A", termId: "term" });
    expect(result()).toMatchObject({ practical: "Pending", id: "enrolment" });
  });
  it("does not serialize private source/override payloads or legacy academic marks", () => {
    const serialized = JSON.stringify(moduleResult(enrolment, offering, courseModule, term, { ...outcome, legacy_final_mark: 99, assessment: { ...outcome.assessment, overrides: [{ kind: "credits", indicator: "", value: 0, reason: "private marker" }] } } as AssessmentSummary));
    expect(serialized).not.toContain("private marker");
    expect(serialized).not.toContain("legacy_final_mark");
    expect(serialized).not.toContain("99%");
  });
});

describe("attendance and presentation evidence", () => {
  it("labels recorded attendance separately from reviewed totals and never invents a requirement", () => {
    expect(attendanceLabel(null, null, 0)).toBe("0 recorded");
    expect(attendanceLabel(null, 5, 2)).toBe("2 recorded");
    expect(attendanceLabel(4, 5, 2)).toBe("4/5");
    expect(attendanceLabel(null, null)).toBe("Unavailable");
    expect(recordedAttendanceDays([
      { date: "2026-10-25", status: "attended" }, { date: "2026-10-25", status: "partial" },
      { date: "2026-10-24", status: "partial" }, { date: "2026-10-23", status: "missed" },
      { date: "2026-10-22", status: "expected" }, { date: "2026-10-21", status: "not_recorded" },
      { date: "2026-10-26", status: "attended" }
    ], "2026-10-25")).toBe(2);
  });
  it("shows only the student's already occurred presentation for this offering without overriding canonical completion", () => {
    const unavailable = { ...result(), presentation: "Unavailable" as const };
    const modules = [unavailable, { ...result(), id: "canonical" }];
    const events = [
      { student_id: "other", offering_id: "offering", occurred_on: "2026-10-24" },
      { student_id: "student", offering_id: "earlier-offering", occurred_on: "2026-10-24" },
      { student_id: "student", offering_id: "offering", occurred_on: "2026-10-26" }
    ];
    attachRecordedPresentations(modules, "student", events, "2026-10-25");
    expect(modules.map(module => module.presentation)).toEqual(["Not recorded", "Complete"]);
    const recorded: CompanionModuleResult = { ...result(), presentation: "Unavailable" };
    const notRequired: CompanionModuleResult = { ...result(), presentation: "N/A" };
    attachRecordedPresentations([recorded, notRequired], "student", [...events, { student_id: "student", offering_id: "offering", occurred_on: "2026-10-25" }], "2026-10-25");
    expect(recorded.presentation).toBe("Recorded");
    expect(notRequired.presentation).toBe("N/A");
    expect(recorded.risk).toEqual(result().risk);
  });
  const session = { id: "session", term_id: "term", session_date: "2026-10-25", starts_at: "09:00", ends_at: "16:00" };
  const record = { student_id: "student", session_id: "session", status: "attended", checked_in_at: "2026-10-25T09:00:00Z", checked_out_at: null };
  it("requires an actual unclosed check-in on a session today", () => {
    expect(isHereToday("student", "2026-10-25", [session], [record])).toBe(true);
    expect(isHereToday("student", "2026-10-26", [session], [record])).toBe(false);
    expect(isHereToday("student", "2026-10-25", [session], [{ ...record, checked_out_at: "2026-10-25T10:00:00Z" }])).toBe(false);
    expect(isHereToday("student", "2026-10-25", [session], [{ ...record, checked_in_at: null, status: "expected" }])).toBe(false);
  });
  it("retains partial/missed sessions, expectations and two same-day modules without counting assessors", () => {
    const presentations = [{ student_id: "student", offering_id: "offering", occurred_on: session.session_date }, { student_id: "student", offering_id: "offering", occurred_on: session.session_date }, { student_id: "student", offering_id: "other", occurred_on: session.session_date }];
    const days = studentDays("student", [session, { ...session, id: "second" }], [{ ...record, status: "partial" }, { ...record, session_id: "second", status: "missed" }], [{ student_id: "student", session_id: "session" }], presentations, [result(), { ...result(), offeringId: "other", code: "LU" } as CompanionModuleResult]);
    expect(days).toEqual([{ date: session.session_date, statuses: ["partial", "missed"], expected: true, presentations: ["VA", "LU"] }]);
  });
  it("uses the teaching timezone across BST and winter midnight", () => {
    expect(teachingDate(new Date("2026-07-01T23:30:00Z"))).toBe("2026-07-02");
    expect(teachingDate(new Date("2026-12-01T23:30:00Z"))).toBe("2026-12-01");
  });
  it("validates identifiers and normalizes bounded filter inputs", () => {
    expect(companionQuerySchema.parse({})).toMatchObject({ page: 1, mode: "module", filter: "all", q: "" });
    expect(companionQuerySchema.safeParse({ studentId: "invalid" }).success).toBe(false);
    expect(companionQuerySchema.parse({ page: "-1", q: "x".repeat(101) })).toMatchObject({ page: 1, q: "" });
  });
});
