import { beforeEach, describe, expect, it, vi } from "vitest";
import { ingestPortalAssessmentResults } from "./portal-ingestion";
import { ingestAssessmentSource, readAssessmentTable } from "./index";
import type { AssessmentSource } from "./types";

vi.mock("server-only",()=>({}));
vi.mock("./index",()=>({ingestAssessmentSource:vi.fn(),readAssessmentTable:vi.fn()}));
const mapping={portal_exam_id:"theory-exam",module_id:"module",term_id:"term",portal_exam_kind:"module_theory",physics_required:true};
const result={token_id:"token",student_name:"Learner 123456789",completed_at:"2026-06-15T12:00:00Z",percentage:20};
function physics(score=90):AssessmentSource {
  return {id:"physics",source_system:"Portal",source_key:"physics-exam:physics-token",student_identifier:"123456789",student_name:"Learner",module_id:null,component:"theory",state:"Unmatched",revision:1,identity_override_reason:null,conflict:null,enrolment_id:null,attempt_id:null,replacement_agrees:null,
    payload:{source_system:"Portal",source_key:"physics-exam:physics-token",student_identifier:"123456789",module_id:null,component:"theory",sitting_date:"2026-06-15",sitting_term_id:"term",items:[{kind:"physics",score}],raw_payload:{percentage:score},reason:"Original import"}};
}
beforeEach(()=>{
  vi.mocked(readAssessmentTable).mockResolvedValue([]);
  vi.mocked(ingestAssessmentSource).mockReset();
  vi.mocked(ingestAssessmentSource).mockResolvedValue({created:1,unchanged:0,source_updated:0,auto_matched:0,unmatched:1,rejected:0,errors:[]});
});
describe("Portal evidence assembly",()=>{
  it("pairs only an unambiguous same-sitting physics source",async()=>{
    vi.mocked(readAssessmentTable).mockResolvedValue([physics()]);
    await ingestPortalAssessmentResults(mapping,[result],"Reviewed sync");
    const input=vi.mocked(ingestAssessmentSource).mock.calls[0][0][0];
    expect(input.student_identifier).toBe("123456789");
    expect(input.items).toEqual([{kind:"mcq",score:20},{kind:"physics",score:90}]);
    expect(input.raw_payload).toMatchObject({physics_source_key:"physics-exam:physics-token"});
  });
  it("does not guess between physics sources or carry forward a prior date",async()=>{
    vi.mocked(readAssessmentTable).mockResolvedValue([physics(),{...physics(),id:"duplicate",source_key:"other"}]);
    await ingestPortalAssessmentResults(mapping,[result],"Reviewed sync");
    expect(vi.mocked(ingestAssessmentSource).mock.calls[0][0][0].items).toHaveLength(1);
    vi.mocked(readAssessmentTable).mockResolvedValue([{...physics(),payload:{...physics().payload,sitting_date:"2026-01-01"}}]);
    await ingestPortalAssessmentResults(mapping,[result],"Reviewed sync");
    expect(vi.mocked(ingestAssessmentSource).mock.calls[1][0][0].items).toHaveLength(1);
  });
  it("does not mistake an exam token for student identity",async()=>{
    await ingestPortalAssessmentResults(mapping,[{...result,student_name:"Unidentified Learner",token:"123456789"}],"Reviewed sync");
    expect(vi.mocked(ingestAssessmentSource).mock.calls[0][0][0].student_identifier).toBe("unresolved:token");
  });
  it("refreshes the explicitly linked physics input without choosing another sitting",async()=>{
    const theory:AssessmentSource={...physics(),id:"theory",source_key:"theory-exam:token",module_id:"module",state:"Matched",
      payload:{...physics().payload,source_key:"theory-exam:token",module_id:"module",items:[{kind:"mcq",score:20},{kind:"physics",score:90}],raw_payload:{submission:result,physics_source_key:"physics-exam:physics-token",physics_payload:physics().payload}}};
    vi.mocked(readAssessmentTable).mockResolvedValue([physics(),theory]);
    vi.mocked(ingestAssessmentSource).mockResolvedValueOnce({created:0,unchanged:0,source_updated:1,auto_matched:0,unmatched:1,rejected:0,errors:[]});
    await ingestPortalAssessmentResults({...mapping,portal_exam_id:"physics-exam",portal_exam_kind:"physics_equipment",module_id:null},[{...result,token_id:"physics-token",percentage:60}],"Reviewed refresh");
    expect(vi.mocked(ingestAssessmentSource).mock.calls[1][0][0].items).toEqual([{kind:"mcq",score:20},{kind:"physics",score:60}]);
    expect(vi.mocked(ingestAssessmentSource).mock.calls[1][0][0].source_key).toBe("theory-exam:token");
  });
});
