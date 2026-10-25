import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth";
import { readAssessmentTable } from "@/lib/assessment";
import { rowsToCsv } from "@/lib/exports";

export async function GET(request:NextRequest) {
  await requirePermission("manage_course");
  const report=request.nextUrl.searchParams.get("report");
  if(report!=="backfill" && report!=="shadow") return NextResponse.json({error:"Unknown report"},{status:400});
  const rows=await readAssessmentTable<Record<string,unknown>>(report==="backfill"?"assessment_backfill_candidates":"assessment_shadow_comparison");
  const columns=rows.length?Object.keys(rows[0]):["No rows"];
  const csv=rowsToCsv([columns,...rows.map(row=>columns.map(column=>{
    const value=row[column];
    const text=value===null?"":typeof value==="object"?JSON.stringify(value):String(value);
    return /^[=+@\-\t\r]/.test(text)?`'${text}`:text;
  }))]);
  return new NextResponse(csv,{headers:{"content-type":"text/csv; charset=utf-8","content-disposition":`attachment; filename="assessment-${report}.csv"`}});
}
