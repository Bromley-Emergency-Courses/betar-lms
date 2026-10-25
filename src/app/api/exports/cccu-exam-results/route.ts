import { NextResponse } from "next/server";
import { cccuExamExportCsv } from "@/lib/exports";
import { getLmsData } from "@/lib/lms-data";
import { requirePermission } from "@/lib/auth";
import { assessmentWorkflowMode } from "@/lib/assessment/feature";
import { readAssessmentWorkspace } from "@/lib/assessment";
import { assessmentExportCsv } from "@/lib/assessment/exports";

export async function GET() {
  await requirePermission("view_students");
  const workspace = assessmentWorkflowMode() === "live" ? await readAssessmentWorkspace() : null;
  const csv = workspace ? assessmentExportCsv("cccu",workspace.outcomes,workspace.attempts,workspace.sources) : cccuExamExportCsv(await getLmsData());
  return new NextResponse(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": 'attachment; filename="cccu-exam-results.csv"'
    }
  });
}
