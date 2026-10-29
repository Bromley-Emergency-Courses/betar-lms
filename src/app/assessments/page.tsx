import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { AssessmentRegister } from "@/components/assessment-register";
import { WorkspaceRefresh } from "@/components/student-workspace";
import { EnrolmentAssessments } from "@/components/enrolment-assessments";
import { requirePermission } from "@/lib/auth";
import { assessmentOperationsPaused, assessmentPrototypeEnabled, assessmentWorkflowEnabled, studentWorkspaceEnabled } from "@/lib/assessment/feature";
import { readAssessmentRecords, readAssessmentWorkspace, readAssessmentTable } from "@/lib/assessment";
import { getLmsData } from "@/lib/lms-data";
import { AssessmentUiPrototype } from "./prototype/assessment-ui-prototype";

export default async function AssessmentsPage({searchParams}:{searchParams:Promise<{mode?:string;student?:string;state?:string;query?:string;queue?:string;summary?:string;variant?:string;workspace?:string;view?:string}>}) {
  const profile=await requirePermission("view_students");
  const params=await searchParams;
  if (!assessmentWorkflowEnabled()) return <AppShell title="Assessments" subtitle="Assessment workflow"><p>The assessment workflow is disabled.</p></AppShell>;
  const prototype = assessmentPrototypeEnabled(params.variant);
  if (studentWorkspaceEnabled() && !prototype && params.view !== "legacy") {
    const records = await readAssessmentRecords(params.student);
    return <AppShell title="Assessments" subtitle="Results, resits and next steps" workspace actions={<Link className="button" href="/students">Students directory</Link>}>
      <WorkspaceRefresh />
      <p className="muted">Development review · Saved results, imported corrections, exclusions/restorations, exceptional decisions and resit arrangements.</p>
      <AssessmentRegister {...records} canEdit={profile.role === "admin" && !assessmentOperationsPaused()} />
    </AppShell>;
  }
  const editMode=profile.role==="admin" && params.mode==="edit" && !assessmentOperationsPaused();
  const [workspace,data]=await Promise.all([readAssessmentWorkspace(params.student),getLmsData()]);
  if (prototype) {
    return <AppShell title="Assessments" subtitle="Results, resits and next steps">
      {params.workspace === "1" ? <p><Link className="button" href="/students?variant=A">Students directory</Link></p> : null}
      <AssessmentUiPrototype outcomes={workspace.outcomes} attempts={workspace.attempts} variant={params.variant as "A" | "B" | "C"} canEdit={profile.role === "admin"} connected={params.workspace === "1"} />
    </AppShell>;
  }
  const versions=await readAssessmentTable<Record<string,unknown>>("module_assessment_source_versions");
  const sources=workspace.sources.filter(source=>(!params.state || source.state===params.state || (params.state==="conflict" && source.conflict) || (params.state==="identity" && source.identity_override_reason))
    && (!params.query || JSON.stringify(source).toLowerCase().includes(params.query.toLowerCase())));
  const queue=workspace.outcomes.filter(row=>params.queue === "risk" ? !["Abandoned","Module deferred","Assessment deferred"].includes(row.assessment.effective_status) && (row.assessment.effective_status === "Fail" || row.assessment.effective_indicators?.length) : params.queue ? row.assessment.effective_status===params.queue : false);
  return <AppShell title="Assessment register" subtitle="Current outcomes, immutable attempts and import reconciliation" actions={<>{profile.role==="admin"?<Link className="button" href={`/assessments?mode=${editMode?"view":"edit"}`}>{editMode?"View mode":"Edit mode"}</Link>:null}<Link className="button" href="/exams?mode=edit">Import tools</Link></>}>
    {params.summary ? <p role="status">Import summary: {params.summary}</p> : null}
    {profile.role==="admin"?<p><Link className="button" href="/assessments/reconciliation">Backfill review and shadow comparison</Link></p>:null}
    <div className="toolbar">{["outcomes","attempts","reconciliation","cccu"].map(report=><Link className="button" key={report} href={`/api/exports/assessments?report=${report}`}>{report} CSV</Link>)}</div>
    <form className="toolbar"><input type="hidden" name="mode" value={params.mode??"view"}/><label>Follow-up queue<select className="select" name="queue" defaultValue={params.queue??""}><option value="">Select queue</option>{["risk","Assessment deferred","Abandoned","Module deferred"].map(queue=><option key={queue}>{queue}</option>)}</select></label><button className="button">Show queue</button></form>
    {params.queue ? <div className="panel">{queue.length?queue.map(row=><p key={row.enrolment_id}><Link href={`/assessments?student=${row.student_id}`}>{row.student_name}</Link> · {row.module_code} · {row.assessment.effective_status} · {row.assessment.effective_indicators.join(" · ")}</p>):<p>No enrolments in this queue.</p>}</div>:null}
    <EnrolmentAssessments studentId={params.student} editMode={editMode} terms={data.terms}/>
    <h2>Imported source evidence</h2><form className="toolbar"><input type="hidden" name="mode" value={params.mode??"view"}/><label>Lifecycle<select className="select" name="state" defaultValue={params.state??""}><option value="">All</option>{["Matched","Unmatched","Replaced manually","Voided","conflict","identity"].map(state=><option key={state}>{state}</option>)}</select></label><label>Search<input className="input" name="query" defaultValue={params.query}/></label><button className="button">Filter</button></form>
    {sources.map(source=><details className="panel" key={source.id}><summary>{source.student_name || source.student_identifier} · {source.component} · {source.source_system} · {source.state}{source.conflict?" · Conflict":""}{source.identity_override_reason?" · Source Identity Override":""}</summary>
      <p>{source.conflict}{source.identity_override_reason?` Identity override: ${source.identity_override_reason}`:""}{source.state==="Replaced manually"?` Latest source agrees with replacement: ${source.replacement_agrees?"Yes":"No"}`:""}</p>
      <pre style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere"}}>{JSON.stringify(source.payload,null,2)}</pre>
      <details><summary>Immutable source versions</summary><pre style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere"}}>{JSON.stringify(versions.filter(version=>version.source_id===source.id),null,2)}</pre></details>
    </details>)}
  </AppShell>;
}
