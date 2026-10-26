import "server-only";
import { requirePermission } from "./auth";
import { createSupabaseServerClient } from "./supabase";
import { readAssessmentSummaries } from "./assessment";
import { assessmentWorkflowMode, staffCompanionEnabled, staffCompanionTeachingEnabled } from "./assessment/feature";
import type { TeachingOptions } from "./student-teaching";
import { readStudentAttendance } from "./student-attendance-store";
import { presentationBreakdown } from "./presentation-display";
import {
  companionPageSize, companionQuerySchema, companionScreen, isHereToday, moduleResult, studentDays, teachingDate, termAttendance,
  type CompanionAttendance, type CompanionData, type CompanionEnrolment, type CompanionExpectation,
  type CompanionModule, type CompanionModuleResult, type CompanionOffering, type CompanionPresentation,
  type CompanionProfile, type CompanionSession, type CompanionTeaching, type CompanionTerm
} from "./staff-companion";

type Client = Awaited<ReturnType<typeof createSupabaseServerClient>>;
type Identity = { id: string; first_name: string; last_name: string; cccu_student_id: string | null; temporary_id: string; status: string };
type TeachingRow = {
  id: string; student_id: string; offering_id: string; staff_user_id: string; occurred_on: string;
  summary?: string; concern_level?: string; comments?: string; total_score?: number; duration_minutes?: number; presentation_type?: string;
  scores?: Record<string, number>; definition_id?: string; overall_score?: number; assessed_item_ids?: string[];
  time_penalty?: number;
};

async function rows<Row>(client: Client, table: string, columns: string, scope?: { column: string; ids: string[] }, order = "id"): Promise<Row[]> {
  const result: Row[] = [];
  const identifiers = scope ? [...new Set(scope.ids)] : [];
  const batches = scope ? Array.from({ length: Math.ceil(identifiers.length / 50) }, (_, index) => identifiers.slice(index * 50, index * 50 + 50)) : [null];
  for (const batch of batches) {
    if (batch && !batch.length) continue;
    for (let offset = 0; ; offset += 500) {
      let query = client.from(table).select(columns).order(order);
      if (table === "expected_attendance") query = query.order("session_id");
      if (scope && batch) query = query.in(scope.column, batch);
      const { data, error } = await query.range(offset, offset + 499);
      if (error) throw new Error(error.message);
      result.push(...data as Row[]);
      if (data.length < 500) break;
    }
  }
  return result;
}

async function moduleResults(enrolments: CompanionEnrolment[], offerings: CompanionOffering[], modules: CompanionModule[], terms: CompanionTerm[]): Promise<CompanionModuleResult[]> {
  const outcomes = await readAssessmentSummaries(enrolments.map(enrolment => enrolment.id));
  return enrolments.map(enrolment => {
    const offering = offerings.find(candidate => candidate.id === enrolment.offering_id);
    const courseModule = modules.find(candidate => candidate.id === offering?.module_id);
    const term = terms.find(candidate => candidate.id === offering?.term_id);
    if (!offering || !courseModule || !term) throw new Error("Enrolment context is unavailable.");
    return moduleResult(enrolment, offering, courseModule, term, outcomes.find(outcome => outcome.enrolment_id === enrolment.id));
  });
}

async function teachingRecords(client: Client, studentId: string, modules: CompanionModuleResult[]): Promise<CompanionTeaching[]> {
  const scope = { column: "student_id", ids: [studentId] };
  const common = "id,student_id,offering_id,staff_user_id,occurred_on";
  const [encounters, formative, presentations] = await Promise.all([
    rows<TeachingRow>(client, "encounter_logs", common + ",summary,concern_level", scope),
    rows<TeachingRow>(client, "assessment_attempts", common + ",definition_id,overall_score,assessed_item_ids,scores,comments", scope),
    rows<TeachingRow>(client, "presentation_scores", common + ",presentation_type,duration_minutes,scores,total_score,time_penalty,comments", scope)
  ]);
  const all = [...encounters, ...formative, ...presentations].filter(record => modules.some(module => module.offeringId === record.offering_id));
  const [authors, definitions] = await Promise.all([
    rows<{ id: string; full_name: string }>(client, "staff_profiles", "id,full_name", { column: "id", ids: [...new Set(all.map(record => record.staff_user_id))] }),
    rows<{ id: string; name: string; domains: Array<{ id: string; label: string }> }>(client, "assessment_definitions", "id,name,domains", { column: "id", ids: [...new Set(formative.flatMap(record => record.definition_id ? [record.definition_id] : []))] })
  ]);
  return all.map(record => {
    const courseModule = modules.find(candidate => candidate.offeringId === record.offering_id)!;
    const kind = encounters.includes(record) ? "Encounter" : presentations.includes(record) ? "Presentation" : "Formative assessment";
    const definition = definitions.find(candidate => candidate.id === record.definition_id);
    const details = kind === "Presentation" ? [
      { label: "Type", value: record.presentation_type?.replaceAll("_", " ") ?? "Not recorded" },
      { label: "Duration", value: record.duration_minutes == null ? "Not recorded" : `${record.duration_minutes} minutes` },
      ...presentationBreakdown(record.scores ?? {}, record.total_score ?? 0, record.time_penalty)
    ] : kind === "Encounter" ? [{ label: "Concern", value: record.concern_level?.replaceAll("_", " ") ?? "Not recorded" }] : [
      { label: "Assessment", value: definition?.name ?? "Definition unavailable" },
      { label: "Score", value: record.overall_score == null ? "Not recorded" : String(record.overall_score) },
      ...(record.assessed_item_ids ?? []).map(id => ({ label: "Assessed item", value: definition?.domains.find(domain => domain.id === id)?.label ?? "Earlier assessment item" })),
      ...Object.entries(record.scores ?? {}).map(([id, score]) => ({ label: definition?.domains.find(domain => domain.id === id)?.label ?? id.replaceAll("_", " "), value: String(score) }))
    ];
    return { id: record.id, date: record.occurred_on, kind, author: authors.find(author => author.id === record.staff_user_id)?.full_name ?? "Teaching staff", module: `${courseModule.code} · ${courseModule.title}`, term: courseModule.term, comment: record.summary ?? record.comments ?? "", details };
  }).sort((first, second) => second.date.localeCompare(first.date) || first.id.localeCompare(second.id));
}

async function attachPresentationPlans(client: Client, modules: CompanionModuleResult[]) {
  const plans = await rows<{ enrolment_id: string; session_id: string | null }>(client, "presentation_plans", "enrolment_id,session_id", { column: "enrolment_id", ids: modules.map(module => module.id) }, "enrolment_id");
  const sessions = await rows<{ id: string; session_date: string; term_id: string }>(client, "attendance_sessions", "id,session_date,term_id", { column: "id", ids: plans.flatMap(plan => plan.session_id ? [plan.session_id] : []) });
  for (const courseModule of modules) {
    const plan = plans.find(plan => plan.enrolment_id === courseModule.id);
    const session = sessions.find(session => session.id === plan?.session_id && session.term_id === courseModule.termId);
    if (session && courseModule.presentation === "Incomplete") courseModule.plannedPresentationDate = session.session_date;
  }
}

export async function readStaffCompanion(input: Record<string, string | undefined>): Promise<CompanionData> {
  await requirePermission("record_teaching");
  if (!staffCompanionEnabled()) throw new Error("The staff companion is disabled.");
  const query = companionQuerySchema.parse(input);
  if (companionScreen(query) !== "overview" && !query.studentId) { query.mode = "term"; query.filter = "all"; }
  const client = await createSupabaseServerClient();
  const [terms, modules, offerings] = await Promise.all([
    rows<CompanionTerm>(client, "terms", "id,name,status,starts_on"),
    rows<CompanionModule>(client, "course_modules", "id,code,title"),
    rows<CompanionOffering>(client, "module_offerings", "id,term_id,module_id,presentation_required")
  ]);
  terms.sort((first, second) => second.starts_on.localeCompare(first.starts_on));
  query.term = terms.find(term => term.id === query.term)?.id ?? terms.find(term => term.status === "active")?.id ?? terms[0]?.id;
  const termOfferings = offerings.filter(offering => offering.term_id === query.term);
  const availableModules = modules.filter(module => termOfferings.some(offering => offering.module_id === module.id)).sort((first, second) => first.code.localeCompare(second.code));
  query.module = availableModules.find(module => module.id === query.module)?.id ?? availableModules[0]?.id;
  const data: CompanionData = { query, terms, modules: availableModules, today: teachingDate(), mode: assessmentWorkflowMode() === "live" ? "live" : "shadow", teachingEnabled: staffCompanionTeachingEnabled(), students: [], dates: [], total: 0, profile: null };
  const enrolmentColumns = "id,student_id,offering_id,presentation_required_override";
  const identityColumns = "id,first_name,last_name,cccu_student_id,temporary_id,status";

  if (query.studentId && companionScreen(query) !== "overview") {
    const [identities, enrolments] = await Promise.all([
      rows<Identity>(client, "students", identityColumns, { column: "id", ids: [query.studentId] }),
      rows<CompanionEnrolment>(client, "active_module_enrolments", enrolmentColumns, { column: "student_id", ids: [query.studentId] })
    ]);
    const identity = identities[0];
    if (!identity) return data;
    const results = await moduleResults(enrolments, offerings, modules, terms);
    await attachPresentationPlans(client, results);
    const [attendance, teaching] = await Promise.all([readStudentAttendance(identity.id), teachingRecords(client, identity.id, results)]);
    let teachingOfferingIds: string[] = [];
    let presentationOfferingIds: string[] = [];
    if (data.teachingEnabled) {
      const options = await client.rpc("read_student_teaching_options", { student_key: identity.id });
      if (options.error) throw new Error(options.error.message);
      teachingOfferingIds = (options.data as TeachingOptions).offerings.map(offering => offering.id);
      const presentations = (options.data as TeachingOptions).presentations ?? [];
      presentationOfferingIds = presentations.map(offering => offering.id);
      for (const record of teaching) {
        const own = presentations.find(offering => offering.ownScore?.id === record.id && !offering.ownScore.requiresReview);
        if (own) record.editableOfferingId = own.id;
      }
    }
    const allowedTerms = new Set(results.map(result => result.termId));
    const attendanceTerm = terms.find(term => term.id === query.attendanceTerm && allowedTerms.has(term.id))?.id ?? terms.find(term => term.id === query.term && allowedTerms.has(term.id))?.id ?? terms.find(term => allowedTerms.has(term.id))?.id ?? "";
    const profile: CompanionProfile = {
      id: identity.id, name: `${identity.first_name} ${identity.last_name}`, identifier: identity.cccu_student_id || identity.temporary_id, status: identity.status,
      modules: results, attendanceTerm, teaching, teachingOfferingIds, presentationOfferingIds,
      attendance: attendance.filter(session => session.termId === attendanceTerm && (session.hasRecord || session.expected)).map(session => ({ id: session.id, date: session.date, startsAt: session.startsAt, endsAt: session.endsAt, status: session.status, expected: Boolean(session.expected) }))
    };
    data.profile = profile;
    return data;
  }

  const enrolments = await rows<CompanionEnrolment>(client, "active_module_enrolments", enrolmentColumns, { column: "offering_id", ids: termOfferings.map(offering => offering.id) });
  const candidateIds = [...new Set(enrolments.map(enrolment => enrolment.student_id))];
  const [results, identities, sessions] = await Promise.all([
    moduleResults(enrolments, offerings, modules, terms),
    rows<Identity>(client, "students", identityColumns, { column: "id", ids: candidateIds }),
    rows<CompanionSession>(client, "attendance_sessions", "id,term_id,session_date,starts_at,ends_at", { column: "term_id", ids: query.term ? [query.term] : [] })
  ]);
  const presence = await rows<CompanionAttendance>(client, "attendance_records", "id,student_id,session_id,status,checked_in_at,checked_out_at", { column: "session_id", ids: sessions.filter(session => session.session_date === data.today).map(session => session.id) });
  const ownerByEnrolment = new Map(enrolments.map(enrolment => [enrolment.id, enrolment.student_id]));
  const resultsByStudent = new Map<string, CompanionModuleResult[]>();
  for (const result of results) {
    const owner = ownerByEnrolment.get(result.id)!;
    const previous = resultsByStudent.get(owner) ?? [];
    previous.push(result);
    resultsByStudent.set(owner, previous);
  }
  const forStudent = (id: string) => resultsByStudent.get(id) ?? [];
  const relevant = (id: string) => forStudent(id).filter(result => query.mode === "term" || result.moduleId === query.module);
  const riskForStudent = (id: string) => [...new Set(relevant(id).flatMap(result => result.risk))];
  const candidates = identities.filter(student => relevant(student.id).length && `${student.first_name} ${student.last_name} ${student.cccu_student_id ?? ""} ${student.temporary_id}`.toLowerCase().includes(query.q.toLowerCase())
    && (query.filter !== "here" || isHereToday(student.id, data.today, sessions, presence))
    && (query.filter !== "risk" || riskForStudent(student.id).length))
    .sort((first, second) => first.last_name.localeCompare(second.last_name) || first.first_name.localeCompare(second.first_name) || first.id.localeCompare(second.id));
  data.total = candidates.length;
  query.page = Math.min(query.page, Math.max(1, Math.ceil(data.total / companionPageSize)));
  const page = candidates.slice((query.page - 1) * companionPageSize, query.page * companionPageSize);
  const scope = { column: "student_id", ids: page.map(student => student.id) };
  const [attendance, expectations, presentations, formative] = await Promise.all([
    rows<CompanionAttendance>(client, "attendance_records", "id,student_id,session_id,status,checked_in_at,checked_out_at", scope),
    rows<CompanionExpectation>(client, "expected_attendance", "student_id,session_id", scope, "student_id"),
    rows<CompanionPresentation>(client, "presentation_scores", "id,student_id,offering_id,occurred_on", scope),
    rows<{ student_id: string; offering_id: string }>(client, "assessment_attempts", "id,student_id,offering_id", scope)
  ]);
  const scopedPresentations = presentations.filter(event => termOfferings.some(offering => offering.id === event.offering_id));
  await attachPresentationPlans(client, page.flatMap(student => forStudent(student.id)));
  data.dates = [...new Set([...sessions.map(session => session.session_date), ...scopedPresentations.map(event => event.occurred_on)])].sort();
  data.students = page.map(student => {
    const allModules = forStudent(student.id);
    const selectedModules = relevant(student.id);
    return {
      id: student.id, name: `${student.first_name} ${student.last_name}`, identifier: student.cccu_student_id || student.temporary_id,
      here: isHereToday(student.id, data.today, sessions, presence), risk: riskForStudent(student.id), ...termAttendance(allModules),
      presentationComplete: selectedModules.filter(module => module.presentation === "Complete").length,
      presentationRequired: selectedModules.filter(module => module.presentation !== "N/A").length,
      presentationUnknown: selectedModules.some(module => module.presentation === "Unavailable"),
      formative: formative.filter(record => record.student_id === student.id && selectedModules.some(module => module.offeringId === record.offering_id)).length,
      days: query.mode === "term" ? studentDays(student.id, sessions, attendance, expectations, scopedPresentations, allModules).map(day => ({ ...day, plannedPresentations: allModules.filter(module => module.plannedPresentationDate === day.date).map(module => module.code) })) : []
    };
  });
  return data;
}
