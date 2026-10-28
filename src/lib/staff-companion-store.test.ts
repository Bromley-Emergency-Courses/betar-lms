import { beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { StaffCompanion } from "@/app/staff/companion";
import { readStaffCompanion } from "./staff-companion-store";
import { requirePermission } from "./auth";
import { createSupabaseServerClient } from "./supabase";
import { readAssessmentSummaries } from "./assessment";
import { staffCompanionEnabled, staffCompanionTeachingEnabled } from "./assessment/feature";
import { readStudentAttendance } from "./student-attendance-store";
import type { AssessmentSummary } from "./assessment";

vi.mock("server-only", () => ({}));
vi.mock("@/components/presentation-edit-button", () => ({ PresentationEditButton: () => null }));
vi.mock("@/app/staff/companion-teaching", () => ({ CompanionTeaching: () => null }));
vi.mock("@/app/staff/companion-entry", () => ({ CompanionEntry: () => null }));
vi.mock("./auth", () => ({ requirePermission: vi.fn() }));
vi.mock("./supabase", () => ({ createSupabaseServerClient: vi.fn() }));
vi.mock("./assessment", () => ({ readAssessmentSummaries: vi.fn() }));
vi.mock("./assessment/feature", () => ({ staffCompanionEnabled: vi.fn(), staffCompanionTeachingEnabled: vi.fn(() => false), assessmentWorkflowMode: () => "shadow" }));
vi.mock("./student-attendance-store", () => ({ readStudentAttendance: vi.fn() }));

const identifier = (number: number) => `58000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
const termId = identifier(1), moduleId = identifier(2), offeringId = identifier(3);
let tables: Record<string, Array<Record<string, unknown>>>;
let outcomes: AssessmentSummary[];
const queries: Array<{ table: string; columns: string; filters: Array<{ column: string; ids: string[] }> }> = [];
const from = vi.fn((table: string) => {
  const call = { table, columns: "", filters: [] as Array<{ column: string; ids: string[] }> };
  queries.push(call);
  const query = {
    select: (columns: string) => { call.columns = columns; return query; },
    order: () => query,
    in: (column: string, ids: string[]) => { call.filters.push({ column, ids }); return query; },
    range: async (start: number, end: number) => ({ data: (tables[table] ?? []).filter(row => call.filters.every(filter => filter.ids.includes(String(row[filter.column])))).slice(start, end + 1), error: null })
  };
  return query;
});

beforeEach(() => {
  vi.stubGlobal("React", React);
  vi.clearAllMocks(); queries.length = 0;
  vi.mocked(requirePermission).mockResolvedValue({ id: "staff", fullName: "Teacher", active: true, role: "teacher" });
  vi.mocked(staffCompanionEnabled).mockReturnValue(true);
  vi.mocked(staffCompanionTeachingEnabled).mockReturnValue(false);
  vi.mocked(createSupabaseServerClient).mockResolvedValue({ from } as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>);
  vi.mocked(readStudentAttendance).mockResolvedValue([]);
  tables = {
    terms: [{ id: termId, name: "Autumn 2026", status: "active", starts_on: "2026-09-01" }],
    course_modules: [{ id: moduleId, code: "VA", title: "Vascular access" }],
    module_offerings: [{ id: offeringId, term_id: termId, module_id: moduleId, presentation_required: true }],
    active_module_enrolments: [], students: []
  };
  outcomes = [];
  for (let index = 0; index < 27; index++) {
    const studentId = identifier(100 + index), enrolmentId = identifier(200 + index);
    tables.students.push({ id: studentId, first_name: "Student", last_name: `Name${String(index).padStart(2, "0")}`, cccu_student_id: null, temporary_id: `ST${index}`, status: "active", finance_secret: "do not send" });
    tables.active_module_enrolments.push({ id: enrolmentId, student_id: studentId, offering_id: offeringId, presentation_required_override: null });
    outcomes.push({ enrolment_id: enrolmentId, student_id: studentId, assessment: { plan: { mode: "practical" }, components: { theory: { score: index }, practical: { score: null } }, effective_status: index === 26 ? "Fail" : "In progress", effective_indicators: [], attendance_actual: 2, attendance_required: 4, presentation_pending: false } } as unknown as AssessmentSummary);
  }
  vi.mocked(readAssessmentSummaries).mockImplementation(async ids => outcomes.filter(outcome => ids.includes(outcome.enrolment_id)));
});

describe("staff companion server reads", () => {
  it("shows recorded teaching evidence without an inherited assessment plan or a new academic failure", async () => {
    const studentId = identifier(100), sessionId = identifier(900);
    outcomes[0] = { ...outcomes[0], assessment: { needs_plan: true, effective_status: "In progress", effective_indicators: [],
      historical: { protected: true, status: "planned", credits: 10, final_mark: null, grade: null, review_flags: [] }, components: {}
    } } as unknown as AssessmentSummary;
    tables.attendance_sessions = [{ id: sessionId, term_id: termId, session_date: "2026-09-10", starts_at: "09:00", ends_at: "17:00" }];
    tables.attendance_records = [{ id: identifier(901), student_id: studentId, session_id: sessionId, status: "attended" }];
    tables.presentation_scores = [1, 2].map(number => ({ id: identifier(910 + number), student_id: studentId, offering_id: offeringId, occurred_on: "2026-09-10" }));
    const roster = await readStaffCompanion({});
    expect(roster.students[0]).toMatchObject({ attended: null, required: null, recordedAttendance: 1, presentationRecorded: 1, presentationUnknown: true, risk: [] });
    expect(roster.students[1]).toMatchObject({ presentationRecorded: 0, presentationComplete: 1 });
    const html = renderToStaticMarkup(React.createElement(StaffCompanion, { data: roster }));
    expect(html).toContain(">1 recorded</span>");
    expect(html).toContain('aria-label="Presentation recorded; completion not verified">Recorded</span>');
    expect(html).not.toContain(">?</span>");
    const profile = (await readStaffCompanion({ studentId })).profile!;
    expect(profile.modules[0]).toMatchObject({ presentation: "Recorded", status: "In progress", risk: [], attended: null, required: null });
    expect(profile.teachingOfferingIds).toEqual([]);
  });
  it("distinguishes absent teaching records from failed requirements and keeps a presentation plan separate", async () => {
    outcomes[0] = { ...outcomes[0], assessment: { needs_plan: true, effective_status: "Pass", effective_indicators: [],
      historical: { protected: true, status: "completed", credits: 10, final_mark: null, grade: null, review_flags: [] }, components: {}
    } } as unknown as AssessmentSummary;
    const sessionId = identifier(900);
    tables.attendance_sessions = [{ id: sessionId, term_id: termId, session_date: "2099-10-30", starts_at: "09:00", ends_at: "17:00" }];
    tables.expected_attendance = [{ student_id: identifier(100), session_id: sessionId }];
    tables.presentation_plans = [{ enrolment_id: identifier(200), session_id: sessionId }];
    const roster = await readStaffCompanion({ mode: "term" });
    expect(roster.students[0]).toMatchObject({ recordedAttendance: 0, presentationRecorded: 0, presentationUnknown: true, risk: [] });
    expect(roster.students[0].days[0]).toMatchObject({ expected: true, presentations: [], plannedPresentations: ["VA"] });
    const html = renderToStaticMarkup(React.createElement(StaffCompanion, { data: roster }));
    expect(html).toContain("Attendance 0 recorded");
    expect(html).toContain("Presentations 0/1 evidenced");
    expect((await readStaffCompanion({ studentId: identifier(100) })).profile?.modules[0]).toMatchObject({ presentation: "Not recorded", status: "Pass", risk: [] });
  });
  it("does not count another term's attendance or a different offering's presentation in the selected roster", async () => {
    outcomes[0] = { ...outcomes[0], assessment: { ...outcomes[0].assessment, needs_plan: true } };
    tables.attendance_sessions = [{ id: identifier(900), term_id: identifier(999), session_date: "2026-09-10", starts_at: "09:00", ends_at: "17:00" }];
    tables.attendance_records = [{ id: identifier(901), student_id: identifier(100), session_id: identifier(900), status: "attended" }];
    tables.presentation_scores = [{ id: identifier(902), student_id: identifier(100), offering_id: identifier(998), occurred_on: "2026-09-10" }];
    const data = await readStaffCompanion({});
    expect(data.students[0]).toMatchObject({ recordedAttendance: 0, presentationRecorded: 0, presentationUnknown: true });
    const html = renderToStaticMarkup(React.createElement(StaffCompanion, { data }));
    expect(html).toContain('aria-label="Presentation not recorded; completion not verified">Not recorded</span>');
  });
  it("returns historical scores and current protected status in the selected Staff profile without enabling writes", async () => {
    outcomes[0] = { ...outcomes[0], assessment: { needs_plan: true, effective_status: "In progress", effective_indicators: [],
      historical: { protected: true, status: "planned", current_term_in_progress: true, credits: 10, final_mark: null, grade: null, review_flags: [] },
      components: { theory: { origin: "Historical record", score: 72, attempt_count: 1 }, practical: { origin: "Historical record", score: null, attempt_count: 0 } },
      overrides: [{ kind: "credits", value: 10, reason: "Private administrative explanation" }]
    } } as unknown as AssessmentSummary;
    const profile = (await readStaffCompanion({ studentId: identifier(100) })).profile!;
    expect(profile.modules[0]).toMatchObject({ status: "In progress", theory: "72% (recorded)", practical: "Not recorded" });
    expect(profile.teachingOfferingIds).toEqual([]);
    expect(profile.presentationOfferingIds).toEqual([]);
    expect(JSON.stringify(profile)).not.toContain("Private administrative explanation");
    expect(readAssessmentSummaries).toHaveBeenCalledWith([identifier(200)]);
  });
  it("can retain a selected student on Overview without replacing the roster with their profile", async () => {
    const data = await readStaffCompanion({ screen: "overview", studentId: identifier(100) });
    expect(data.profile).toBeNull();
    expect(data.students).toHaveLength(20);
    expect(data.query.studentId).toBe(identifier(100));
    expect(readStudentAttendance).not.toHaveBeenCalled();
  });
  it("lets Student and Add record pick from the selected term without hiding students behind risk filters", async () => {
    for (const screen of ["student", "entry"]) {
      const data = await readStaffCompanion({ screen, filter: "here" });
      expect(data.profile).toBeNull();
      expect(data.total).toBe(27);
      expect(data.query.mode).toBe("term");
      expect(data.query.filter).toBe("all");
    }
  });
  it("shows module-labelled planned presentations without changing attendance or completion", async () => {
    const sessionId = identifier(900);
    tables.attendance_sessions = [{ id: sessionId, term_id: termId, session_date: "2026-10-30", starts_at: "09:00", ends_at: "17:00" }];
    tables.presentation_plans = [{ enrolment_id: identifier(200), session_id: sessionId }];
    outcomes[0].assessment.presentation_pending = true;
    const roster = await readStaffCompanion({ term: termId, mode: "term" });
    expect(roster.students[0].days[0].plannedPresentations).toEqual(["VA"]);
    expect(roster.students[0].presentationComplete).toBe(0);
    expect(roster.students[0].days[0].expected).toBe(false);
    const profile = await readStaffCompanion({ studentId: identifier(100) });
    expect(profile.profile?.modules[0].plannedPresentationDate).toBe("2026-10-30");
    outcomes[0].assessment.presentation_pending = false;
    expect((await readStaffCompanion({ studentId: identifier(100) })).profile?.modules[0].plannedPresentationDate).toBeUndefined();
  });
  it("exposes teaching controls only for the existing RPC's eligible offerings when explicitly enabled", async () => {
    vi.mocked(staffCompanionTeachingEnabled).mockReturnValue(true);
    const rpc = vi.fn().mockResolvedValue({ data: { offerings: [{ id: offeringId }], definitions: [] }, error: null });
    vi.mocked(createSupabaseServerClient).mockResolvedValue({ from, rpc } as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>);
    const data = await readStaffCompanion({ studentId: identifier(100) });
    expect(data.teachingEnabled).toBe(true);
    expect(data.profile?.teachingOfferingIds).toEqual([offeringId]);
    expect(rpc).toHaveBeenCalledExactlyOnceWith("read_student_teaching_options", { student_key: identifier(100) });
    rpc.mockResolvedValue({ data: null, error: { message: "Options unavailable" } });
    await expect(readStaffCompanion({ studentId: identifier(100) })).rejects.toThrow("Options unavailable");
  });
  it("rejects unauthorised callers before touching the data layer", async () => {
    vi.mocked(requirePermission).mockRejectedValue(new Error("Denied"));
    await expect(readStaffCompanion({})).rejects.toThrow("Denied");
    expect(requirePermission).toHaveBeenCalledWith("record_teaching");
    expect(createSupabaseServerClient).not.toHaveBeenCalled();
  });
  it("rejects disabled and invalid requests without querying data", async () => {
    vi.mocked(staffCompanionEnabled).mockReturnValue(false);
    await expect(readStaffCompanion({})).rejects.toThrow("disabled");
    vi.mocked(staffCompanionEnabled).mockReturnValue(true);
    await expect(readStaffCompanion({ studentId: "bad" })).rejects.toThrow();
    expect(createSupabaseServerClient).not.toHaveBeenCalled();
  });
  it("pages students after cross-enrolment filters and scopes detailed evidence to that page", async () => {
    const data = await readStaffCompanion({ page: "2" });
    expect(data.total).toBe(27);
    expect(data.students).toHaveLength(7);
    expect(data.students[0].identifier).toBe("ST20");
    const evidenceQueries = queries.filter(query => ["presentation_scores", "assessment_attempts", "expected_attendance"].includes(query.table));
    expect(evidenceQueries.every(query => query.filters.some(filter => filter.column === "student_id" && filter.ids.length === 7))).toBe(true);
    expect(queries.every(query => query.columns !== "*")).toBe(true);
    expect(JSON.stringify(data)).not.toContain("finance_secret");
    expect(queries.some(query => ["finance_records", "admission_leads", "assessment_import_reconciliation", "exam_results", "assessment_attempt_history"].includes(query.table))).toBe(false);
  });
  it("filters risk and search before pagination, including matches beyond the first page", async () => {
    expect((await readStaffCompanion({ filter: "risk" })).students.map(student => student.identifier)).toEqual(["ST26"]);
    expect((await readStaffCompanion({ q: "ST25" })).students.map(student => student.identifier)).toEqual(["ST25"]);
    expect((await readStaffCompanion({ filter: "here" })).students).toEqual([]);
  });
  it("loads one student's profile from authoritative outcomes and no unrelated history", async () => {
    const data = await readStaffCompanion({ studentId: identifier(100) });
    expect(data.profile).toMatchObject({ id: identifier(100), name: "Student Name00", modules: [{ theory: "0%", practical: "Pending", presentation: "Complete" }] });
    expect(readAssessmentSummaries).toHaveBeenCalledWith([identifier(200)]);
    expect(readStudentAttendance).toHaveBeenCalledExactlyOnceWith(identifier(100));
    expect(queries.filter(query => ["encounter_logs", "assessment_attempts", "presentation_scores"].includes(query.table)).every(query => query.filters[0]?.ids.length === 1)).toBe(true);
    expect(JSON.stringify(data)).not.toContain("do not send");
  });
  it("does not reintroduce cancelled enrolments or hide result-load failures as Pending", async () => {
    tables.active_module_enrolments = [];
    expect((await readStaffCompanion({ studentId: identifier(100) })).profile?.modules).toEqual([]);
    vi.mocked(readAssessmentSummaries).mockRejectedValue(new Error("Database unavailable"));
    await expect(readStaffCompanion({})).rejects.toThrow("Database unavailable");
  });
  it("retains separate repeated teaching enrolments and original-term ownership of current results", async () => {
    const laterTerm = identifier(400), laterOffering = identifier(401), laterEnrolment = identifier(402);
    tables.terms.push({ id: laterTerm, name: "Spring 2027", status: "draft", starts_on: "2027-01-01" });
    tables.module_offerings.push({ ...tables.module_offerings[0], id: laterOffering, term_id: laterTerm });
    tables.active_module_enrolments.push({ ...tables.active_module_enrolments[0], id: laterEnrolment, offering_id: laterOffering });
    outcomes[0].assessment.components.theory!.score = 75;
    outcomes[0].assessment.effective_status = "Pass";
    outcomes.push({ ...outcomes[0], enrolment_id: laterEnrolment, assessment: { ...outcomes[0].assessment, effective_status: "In progress", components: { theory: { ...outcomes[0].assessment.components.theory, score: null } } } });
    const data = await readStaffCompanion({ studentId: identifier(100) });
    expect(data.profile?.modules).toMatchObject([
      { id: identifier(200), termId, theory: "75%", status: "Pass" },
      { id: laterEnrolment, termId: laterTerm, theory: "Pending", status: "In progress" }
    ]);
    expect(readAssessmentSummaries).toHaveBeenCalledWith([identifier(200), laterEnrolment]);
  });
  it("shows encounter attribution and complete recorded presentation scores without recalculating totals", async () => {
    const authorId = identifier(500);
    tables.staff_profiles = [{ id: authorId, full_name: "Synthetic Teacher" }];
    const common = { student_id: identifier(100), offering_id: offeringId, staff_user_id: authorId, occurred_on: "2026-10-20" };
    tables.encounter_logs = [{ ...common, id: identifier(501), concern_level: "watch", summary: "Review next week" }];
    tables.presentation_scores = [{ ...common, id: identifier(502), presentation_type: "journal_club", duration_minutes: 12, total_score: 19, scores: { content_material_accurate_up_to_date: 0 } }];
    const data = await readStaffCompanion({ studentId: identifier(100) });
    expect(data.profile?.teaching[0]).toMatchObject({ author: "Synthetic Teacher", module: "VA · Vascular access", term: "Autumn 2026", comment: "Review next week", details: [{ label: "Concern", value: "watch" }] });
    expect(data.profile?.teaching[1].details).toContainEqual({ label: "Recorded total", value: "19/50" });
    expect(data.profile?.teaching[1].details).toContainEqual({ label: "Material is accurate and up to date", value: "0/5" });
    expect(data.profile?.teaching[1].details.some(detail => detail.value === "Not recorded")).toBe(true);
  });
});
