import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    endpoint: "/api/exam-adapters/results",
    method: "POST",
    authentication: "Bearer token matching EXAM_ADAPTER_SHARED_SECRET",
    payload: [
      {
        sourceSystem: "theory_portal",
        sourceAttemptId: "theory-2026-core-184",
        componentType: "theory",
        cccuStudentId: "CCCU240184",
        temporaryId: "BETAR-TMP-1001",
        moduleCode: "POCUS-CORE",
        termName: "April-June 2026",
        score: 68,
        passMark: 50,
        takenOn: "2026-06-29"
      }
    ],
    notes: [
      "cccuStudentId is preferred once CCCU registration is complete.",
      "temporaryId is accepted before CCCU registration.",
      "score and passMark are percentages from 0 to 100.",
      "The LMS treats scores below passMark as resit required."
    ]
  });
}
