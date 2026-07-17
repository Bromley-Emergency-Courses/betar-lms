import { NextResponse } from "next/server";
import { cccuExamExportCsv } from "@/lib/exports";
import { getLmsData } from "@/lib/lms-data";

export async function GET() {
  const csv = cccuExamExportCsv(await getLmsData());
  return new NextResponse(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": 'attachment; filename="cccu-exam-results.csv"'
    }
  });
}
