import { NextResponse } from "next/server";
import { assessmentWorkflowMode } from "@/lib/assessment/feature";

export async function GET() {
  const mode = assessmentWorkflowMode();
  const assessmentEnabled = mode !== "off";
  return NextResponse.json({
    endpoint: "/api/exam-adapters/results",
    method: "POST",
    authentication: assessmentEnabled ? "Bearer token matching EXAM_ADAPTER_SHARED_SECRET plus an active administrator session" : "Bearer token matching EXAM_ADAPTER_SHARED_SECRET",
    assessmentWorkflowMode: mode,
    requiredHeaders: ["authorization", "content-type", ...(assessmentEnabled ? ["x-assessment-reason"] : [])],
    payload: [
      {
        sourceSystem: "theory_portal",
        sourceAttemptId: "theory-2026-core-184",
        componentType: "theory",
        cccuStudentId: "CCCU240184",
        temporaryId: "BETAR-TMP-1001",
        moduleCode: "POCUS-CORE",
        termName: "April 2026",
        score: 68,
        passMark: 50,
        takenOn: "2026-06-29",
        isResit: false,
        attemptNumber: 1
      }
    ],
    notes: [
      "In shadow/live mode, machine-only bearer credentials are insufficient; an active administrator session and non-empty x-assessment-reason are required.",
      "The administrator's Exam Portal sync is a separate outbound pull and does not call this endpoint.",
      "cccuStudentId is preferred once CCCU registration is complete.",
      "temporaryId is accepted before CCCU registration.",
      "score and passMark are percentages from 0 to 100.",
      "termName is the exam sitting term; resits can resolve to an earlier enrolled module offering.",
      "isResit and attemptNumber are optional. Existing payloads default to first-attempt behavior unless an earlier module enrolment makes the result a resit.",
      "The LMS treats scores below passMark as resit required."
    ]
  });
}
