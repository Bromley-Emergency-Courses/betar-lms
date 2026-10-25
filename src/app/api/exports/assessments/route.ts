import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth";
import { readAssessmentWorkspace } from "@/lib/assessment";
import { assessmentExportCsv } from "@/lib/assessment/exports";

export async function GET(request: NextRequest) {
  await requirePermission("view_students");
  const report=request.nextUrl.searchParams.get("report")??"outcomes";
  if (report!=="outcomes" && report!=="attempts" && report!=="reconciliation" && report!=="cccu") return NextResponse.json({error:"Unknown report"},{status:400});
  const {outcomes,attempts,sources}=await readAssessmentWorkspace();
  return new NextResponse(assessmentExportCsv(report,outcomes,attempts,sources),{headers:{"content-type":"text/csv; charset=utf-8","content-disposition":`attachment; filename="assessment-${report}.csv"`}});
}
