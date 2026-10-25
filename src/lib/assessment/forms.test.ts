import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { AssessmentPlanForm, AssessmentScoreForm } from "@/components/assessment-forms";
import type { AssessmentEvaluation } from "./types";

vi.mock("@/app/assessments/actions",()=>({
  submitAssessmentCommand:vi.fn(),submitAssessmentPlan:vi.fn(),previewAssessmentPlan:vi.fn(),submitAssessmentBackfill:vi.fn()
}));
beforeAll(()=>{vi.stubGlobal("React",React);});

function assessment(scheme:"mcq"|"coursework_viva",physics=false):AssessmentEvaluation {
  return {enrolment_id:"enrolment",revision:3,student_id:"student",module_id:"module",original_term_id:"term",
    plan:{id:"plan",module_id:"module",version:1,mode:"online",theory_scheme:scheme,physics_weighting:physics,requires_coursework:scheme==="coursework_viva",requires_viva:scheme==="coursework_viva",theory_pass_mark:50,practical_pass_mark:null},
    components:{theory:{component:"theory",id:null,sequence:null,score:null,pass_mark:null,passed:null,origin:null,revision:null,attempt_count:0,arrangement_kind:null,arrangement_state:null,note:null}},
    calculated_status:"In progress",effective_status:"In progress",calculated_indicators:[],effective_indicators:[],calculated_credits:0,recommended_credits:0,awarded_credits:0,overrides:[],disposition:null,attendance_actual:0,attendance_required:0,presentation_pending:false};
}
describe("plan-driven assessment forms",()=>{
  it("shows only MCQ inputs with a required reason and expected revision",()=>{
    const html=renderToStaticMarkup(React.createElement(AssessmentScoreForm,{assessment:assessment("mcq"),component:"theory",attempts:[],terms:[]}));
    expect(html).toContain('name="item.mcq.score"');
    expect(html).not.toContain('name="score"');
    expect(html).not.toContain('item.physics.score');
    expect(html).not.toContain('item.coursework.score');
    expect(html).toContain('name="expected_revision" value="3"');
    expect(html).toMatch(/name="reason" required/);
  });
  it("requires weighted MCQ/physics and supplied Coursework/Viva combined Theory independently",()=>{
    const weighted=renderToStaticMarkup(React.createElement(AssessmentScoreForm,{assessment:assessment("mcq",true),component:"theory",attempts:[],terms:[]}));
    expect(weighted).toContain('name="item.physics.score"');
    expect(weighted).not.toContain('name="score"');
    const coursework=renderToStaticMarkup(React.createElement(AssessmentScoreForm,{assessment:assessment("coursework_viva"),component:"theory",attempts:[],terms:[]}));
    expect(coursework).toContain('name="item.coursework.score"');
    expect(coursework).toContain('name="item.viva.score"');
    expect(coursework).toContain('name="score"');
    expect(coursework).not.toContain('item.mcq.score');
    expect(coursework).toContain("Authoritative combined Theory score");
  });
  it("has no Practical pass-mark setting for Online modules",()=>{
    const html=renderToStaticMarkup(React.createElement(AssessmentPlanForm,{moduleId:"module",mode:"online"}));
    expect(html).not.toContain('name="practical_pass_mark"');
    expect(html).toContain("future enrolments");
  });
  it("does not offer source replacement or cross-student identity overrides",()=>{
    const html=renderToStaticMarkup(React.createElement(AssessmentScoreForm,{assessment:assessment("mcq"),component:"theory",attempts:[],terms:[]}));
    expect(html).not.toContain("ReplaceSourceResult");
    expect(html).not.toContain("identity_override_reason");
    expect(html).not.toContain("source_id");
  });
});
