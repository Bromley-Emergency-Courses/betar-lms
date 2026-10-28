import { describe, expect, it } from "vitest";
import { inboundAssessmentSource, portalAssessmentSource, practicalAssessmentSources } from "./adapters";
import { assessmentExportCsv } from "./exports";
import { getAppData } from "@/lib/seed";
import { practicalCsvRowsToInboundExamResults } from "@/lib/exam-adapters";
import { studentAcademicRisk } from "@/lib/rules";
import type { AssessmentAttempt, AssessmentEvaluation, AssessmentOutcome, AssessmentSource } from "./types";

const evaluation = {
  enrolment_id:"enrolment-1", revision:1, student_id:"student-1", module_id:"module-1", original_term_id:"term-1",
  plan:{id:"plan-1",module_id:"module-1",version:1,mode:"online",theory_scheme:"mcq",requires_coursework:false,requires_viva:false,physics_weighting:false,theory_pass_mark:50,practical_pass_mark:null},
  components:{theory:{component:"theory",id:"attempt-1",sequence:2,score:70,pass_mark:50,passed:true,origin:"Manual",revision:1,attempt_count:2,arrangement_kind:null,arrangement_state:null,note:null}},
  calculated_status:"Pass",effective_status:"Pass",calculated_indicators:[],effective_indicators:[],calculated_credits:10,recommended_credits:10,awarded_credits:10,overrides:[],disposition:null,attendance_required:0,attendance_actual:0,presentation_pending:false
} satisfies AssessmentEvaluation;
const outcome: AssessmentOutcome = {enrolment_id:"enrolment-1",student_id:"student-1",student_identifier:"CCCU-1",student_name:"Test Learner",module_code:"MCQ",module_title:"Theory module",original_cohort:"January",assessment:evaluation,legacy_status:"failed",legacy_final_mark:90,legacy_grade:"Old",legacy_credits:0};
const attempt: AssessmentAttempt = {id:"attempt-1",enrolment_id:"enrolment-1",component:"theory",ordinal:2,sequence:2,previous_result_unavailable:null,origin:"Manual",source_id:"source-1",active:true,revision:1,revision_id:"revision-1",score:70,pass_mark:50,passed:true,sitting_date:"2026-06-15",sitting_term:"June",sitting_term_id:"term-2",is_current:true,reason:"Manual replacement",items:[]};
const source: AssessmentSource = {id:"source-1",source_system:"Portal",source_key:"portal-1",student_identifier:"CCCU-1",student_name:"Test Learner",module_id:"module-1",component:"theory",state:"Replaced manually",revision:2,identity_override_reason:null,conflict:null,payload:{source_system:"Portal",source_key:"portal-1",student_identifier:"CCCU-1",module_id:"module-1",component:"theory",sitting_date:"2026-06-15",raw_payload:{score:20},reason:"Imported"},enrolment_id:"enrolment-1",attempt_id:"attempt-1",replacement_agrees:false};

describe("assessment adapters and reports",()=>{
  it("rejects malformed CSV rows independently while retaining valid raw rows",()=>{
    const result=practicalAssessmentSources([{"Student ID":"CCCU240184",Module:"POCUS-CORE",Percentage:"65"},{"Student ID":"CCCU240185",Module:"POCUS-CORE",Percentage:"bad"}],getAppData(),{termName:"April 2026",takenOn:"2026-06-15",passMark:50,moduleCodeMap:new Map(),reason:"Reviewed import"});
    expect(result.sources).toHaveLength(1);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0].source_key).toBe("CSV row 3");
  });
  it("preserves raw Practical CSV evidence and does not assign enrolment or sequence",()=>{
    const row={"Student ID":"CCCU240184",Module:"POCUS-CORE",Percentage:"42.5"};
    const parsed=practicalCsvRowsToInboundExamResults([row],{termName:"April 2026",takenOn:"2026-06-15",passMark:50});
    const result=inboundAssessmentSource(parsed[0],getAppData(),"Reviewed CSV",row);
    expect(result.raw_payload).toEqual(row);
    expect(result.component).toBe("practical");
    expect(result.score).toBe(42.5);
    expect(result).not.toHaveProperty("enrolment_id");
    expect(result).not.toHaveProperty("sequence");
  });
  it("retains unknown student/module identities for reconciliation",()=>{
    const result=inboundAssessmentSource({sourceSystem:"theory_portal",sourceAttemptId:"unknown",componentType:"theory",cccuStudentId:"unknown",moduleCode:"unknown",termName:"unknown",score:80,passMark:50,takenOn:"2026-06-15"},getAppData(),"Review");
    expect(result.module_id).toBeNull();
    expect(result.student_identifier).toBe("unknown");
  });
  it("preserves an explicit resit hint without supplying an attempt number",()=>{
    const result=inboundAssessmentSource({sourceSystem:"theory_portal",sourceAttemptId:"resit",componentType:"theory",cccuStudentId:"CCCU240184",moduleCode:"POCUS-CORE",termName:"April 2026",score:80,passMark:50,takenOn:"2026-06-15",attemptNumber:4,isResit:true},getAppData(),"Review");
    expect(result.known_resit).toBe(true);
    expect(result).not.toHaveProperty("sequence");
    expect(result).not.toHaveProperty("attemptNumber");
  });
  it("passes weighted inputs to PostgreSQL without calculating Theory in the adapter",()=>{
    const result=portalAssessmentSource({examId:"exam",tokenId:"token",studentIdentifier:"student",studentName:"Learner",moduleId:"module",sittingDate:"2026-06-15",sittingTermId:"term",mcq:20,physics:{score:90,sourceKey:"physics-key"},rawPayload:{percentage:20},reason:"Reviewed"});
    expect(result.items).toEqual([{kind:"mcq",score:20},{kind:"physics",score:90}]);
    expect(result.score).toBeUndefined();
    expect(result.raw_payload).toEqual({submission:{percentage:20},physics_source_key:"physics-key"});
    expect(()=>portalAssessmentSource({examId:"exam",tokenId:"token",studentIdentifier:"student",studentName:"Learner",moduleId:"module",sittingDate:"invalid",sittingTermId:"term",mcq:120,rawPayload:{},reason:"Reviewed"})).toThrow();
  });
  it("exports one current outcome with N/A, explicit recommendations and credits",()=>{
    expect(assessmentExportCsv("outcomes",[outcome],[attempt],[source])).toBe('Student ID,Student Name,Original Cohort,Module Code,Theory,Practical,Effective Status,Calculated Status,Indicators,Theory Attempts,Practical Attempts,Credits,Calculated Credits,Overrides\nCCCU-1,Test Learner,January,MCQ,70,N/A,Pass,Pass,[],2,,10,10,[]');
  });
  it("exports accepted Manual replacement and excludes withdrawn source attempts",()=>{
    const csv=assessmentExportCsv("cccu",[outcome],[attempt,{...attempt,id:"withdrawn",origin:"Portal",active:false,score:20}],[source]);
    expect(csv).toBe('Student ID,Student Name,Term,Module Code,Module Title,Component,Score,Pass Mark,Passed,Resit Required,Attempt Number,Is Resit,Prior Attempt Missing,Taken On,Source System,Original Cohort,Revision,Current Result\nCCCU-1,Test Learner,June,MCQ,Theory module,theory,70,50,Yes,No,2,Yes,No,2026-06-15,Manual,January,1,true');
    expect(assessmentExportCsv("attempts",[outcome],[attempt],[])).toContain("enrolment-1,attempt-1,2,1,theory,70,50,true,2026-06-15,June,Manual,true,");
  });
  it("keeps reconciliation evidence out of official reports and neutralizes spreadsheet formulas",()=>{
    const malicious={...source,student_name:"=HYPERLINK(\"unsafe\")"};
    const csv=assessmentExportCsv("reconciliation",[],[],[malicious,{...source,id:"matched",state:"Matched",replacement_agrees:null}]);
    expect(csv.split("\n")).toHaveLength(2);
    expect(csv).toContain("'=HYPERLINK");
    expect(csv).toContain("Replaced manually");
    expect(assessmentExportCsv("cccu",[outcome],[],[source]).split("\n")).toHaveLength(1);
  });
  it("does not count resolved historical failures as current academic risk",()=>{
    const data=structuredClone(getAppData());
    data.encounters=[];
    const enrolment=data.enrolments.find(enrolment=>enrolment.studentId==="student-1")!;
    enrolment.assessment=evaluation;
    data.examResults=[{id:"historical-fail",studentId:"student-1",offeringId:enrolment.offeringId,componentType:"theory",sourceSystem:"manual",sourceAttemptId:"old",score:20,passMark:50,passed:false,resitRequired:true,isResit:false,attemptNumber:1,priorAttemptMissing:false,takenOn:"2026-01-01",importedAt:"2026-01-01"}];
    expect(studentAcademicRisk("student-1",data)).toBe("none");
    enrolment.assessment={...evaluation,effective_status:"Fail",effective_indicators:["theory:Resit required"]};
    expect(studentAcademicRisk("student-1",data)).toBe("watch");
    enrolment.assessment={...evaluation,effective_status:"Module deferred",effective_indicators:["theory:Resit required"]};
    expect(studentAcademicRisk("student-1",data)).toBe("none");
  });
});
