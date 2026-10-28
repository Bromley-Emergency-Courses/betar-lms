import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { PlanMigrationForm } from "@/components/assessment-forms";
import { requirePermission } from "@/lib/auth";
import { readAssessmentTable } from "@/lib/assessment";
import { assessmentWorkflowEnabled } from "@/lib/assessment/feature";
import type { AssessmentOutcome, AssessmentPlan } from "@/lib/assessment/types";
import { getLmsData } from "@/lib/lms-data";
import styles from "../course-assessment.module.css";

export default async function InheritedPlansPage({ params, searchParams }: {
  params: Promise<{ moduleId: string }>;
  searchParams: Promise<{ term?: string; enrolment?: string }>;
}) {
  await requirePermission("manage_course");
  if (!assessmentWorkflowEnabled()) notFound();
  const { moduleId } = await params;
  const { term, enrolment } = await searchParams;
  const data = await getLmsData();
  const courseModule = data.modules.find(module => module.id === moduleId);
  if (!courseModule) notFound();
  const [plans, outcomes] = await Promise.all([
    readAssessmentTable<AssessmentPlan>("module_assessment_plans", { column: "module_id", value: moduleId }),
    readAssessmentTable<AssessmentOutcome>("assessment_outcomes", { column: "module_code", value: courseModule.code })
  ]);
  const enrolmentTerms = new Map(data.enrolments.map(row => [row.id, data.offerings.find(offering => offering.id === row.offeringId)?.termId]));
  const filtered = outcomes.filter(outcome => !term || enrolmentTerms.get(outcome.enrolment_id) === term);
  const selected = filtered.find(outcome => outcome.enrolment_id === enrolment);
  const path = `/course/assessment-plans/${moduleId}`;
  return <AppShell title="Review inherited assessment plans" subtitle={`${courseModule.code} · ${courseModule.title}`} actions={<Link className="button" href="/course?mode=edit">Course configuration</Link>}>
    <div className={styles.review}>
    <section className="panel grid">
      <p>New versions apply to future enrolments. For existing enrolments, select the original teaching term and student, preview the impact and supply a reason before applying a reviewed version. Recorded attempts and pass marks are retained.</p>
      <form action={path} className="toolbar">
        <label>Original teaching term<select className="select" name="term" defaultValue={term ?? ""}><option value="">All terms</option>{data.terms.map(teachingTerm => <option key={teachingTerm.id} value={teachingTerm.id}>{teachingTerm.name}</option>)}</select></label>
        <button className="button">Filter enrolments</button>
      </form>
      {filtered.length ? <ul>{filtered.map(outcome => <li key={outcome.enrolment_id}>
        <Link href={`${path}?${new URLSearchParams({ ...(term ? { term } : {}), enrolment: outcome.enrolment_id })}`}>{outcome.student_name} · {outcome.student_identifier} · {outcome.original_cohort}</Link> · {outcome.assessment.plan ? `Plan v${outcome.assessment.plan.version}` : "Plan review required"}
      </li>)}</ul> : <p>No enrolments in this teaching term.</p>}
    </section>
    {selected ? <section className="panel grid" aria-label="Selected enrolment">
      <h2>{selected.student_name} · {selected.original_cohort}</h2>
      <p>Current plan: {selected.assessment.plan ? `v${selected.assessment.plan.version}` : "not assigned"}.</p>
      {plans.some(plan => plan.id !== selected.assessment.plan?.id) ? <PlanMigrationForm key={selected.enrolment_id} assessment={selected.assessment} plans={[...plans].sort((first, second) => second.version - first.version)} /> : <p>No alternative reviewed version is available. Create a version in Course configuration first.</p>}
    </section> : <p>Select an enrolment to review its inherited plan.</p>}
    </div>
  </AppShell>;
}
