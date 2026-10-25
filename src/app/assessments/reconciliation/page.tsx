import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { AssessmentBackfillForm } from "@/components/assessment-forms";
import { requirePermission } from "@/lib/auth";
import { readAssessmentTable } from "@/lib/assessment";
import { assessmentWorkflowMode } from "@/lib/assessment/feature";

export default async function AssessmentReconciliationPage() {
  await requirePermission("manage_course");
  if (assessmentWorkflowMode()==="off") return <AppShell title="Assessment reconciliation"><p>The assessment workflow is disabled.</p></AppShell>;
  const [candidates,comparison]=await Promise.all([
    readAssessmentTable<{legacy_result_id:string;legacy_hash:string;review_reason:string|null;legacy_snapshot:Record<string,unknown>}>("assessment_backfill_candidates"),
    readAssessmentTable<Record<string,unknown>>("assessment_shadow_comparison")
  ]);
  candidates.sort((first,second)=>Number(first.legacy_snapshot.attempt_number)-Number(second.legacy_snapshot.attempt_number));
  return <AppShell title="Assessment reconciliation" subtitle="Review exceptions before pilot and cutover">
    <p><Link href="/assessments?mode=edit">Assessment register</Link> · <Link href="/course?mode=edit">Review module plans</Link></p>
    <p>Run the read-only preflight report before rollout. Document each difference as an intentional rule change or an administrator resolution. Production cutover also requires an agreed cohort pilot and recorded sign-offs.</p>
    <div className="toolbar"><a className="button" href="/api/exports/assessment-reconciliation?report=backfill">Backfill exception CSV</a><a className="button" href="/api/exports/assessment-reconciliation?report=shadow">Shadow comparison CSV</a></div>
    <h2>Shadow comparison</h2>{comparison.map(row=><details className="panel" key={String(row.enrolment_id)}><summary>{String(row.student_name)} · {String(row.module_code)} · {String(row.difference??"Status and credits agree")}</summary><pre style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere"}}>{JSON.stringify(row,null,2)}</pre></details>)}
    <h2>Legacy backfill review</h2>{assessmentWorkflowMode()==="shadow"?<AssessmentBackfillForm candidates={candidates}/>:<p>Backfill closes at cutover. Legacy evidence remains read-only.</p>}
  </AppShell>;
}
