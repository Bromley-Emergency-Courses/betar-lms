import { NextRequest, NextResponse } from "next/server";
import { getLmsData } from "@/lib/lms-data";
import {
  normalizeInboundExamResult,
  parseExamAdapterPayload,
  persistNormalizedExamResults,
  summarizeExamIngestion,
  syncEnrolmentStatusesForExamResults
} from "@/lib/exam-adapters";
import { createSupabaseServerClient } from "@/lib/supabase";
import { assessmentWorkflowEnabled, assessmentWorkflowMode } from "@/lib/assessment/feature";
import { ingestAssessmentSource } from "@/lib/assessment";
import { inboundAssessmentSource } from "@/lib/assessment/adapters";
import { getCurrentStaffProfile } from "@/lib/auth";

function isAuthorized(request: NextRequest): boolean {
  const configuredSecret = process.env.EXAM_ADAPTER_SHARED_SECRET;
  if (!configuredSecret) {
    return process.env.NODE_ENV !== "production";
  }
  const authorization = request.headers.get("authorization");
  return authorization === `Bearer ${configuredSecret}`;
}

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const payload = await request.json();
  const parsed = parseExamAdapterPayload(payload);
  let assessmentSummary: Awaited<ReturnType<typeof ingestAssessmentSource>> | undefined;
  if (assessmentWorkflowEnabled()) {
    const profile = await getCurrentStaffProfile();
    if (!profile || profile.role !== "admin") return NextResponse.json({ error: "An active administrator session is required for assessment imports." }, { status: 403 });
    const reason = request.headers.get("x-assessment-reason")?.trim();
    if (!reason) return NextResponse.json({error:"x-assessment-reason is required."},{status:400});
    const data = await getLmsData();
    const summary = await ingestAssessmentSource(parsed.map(result=>inboundAssessmentSource(result,data,reason)));
    assessmentSummary = summary;
    if (assessmentWorkflowMode() === "live") return NextResponse.json(summary);
  }
  const data = await getLmsData();
  const normalized = parsed.map((result) => normalizeInboundExamResult(result, data));
  const supabase = await createSupabaseServerClient();
  const acceptedResults = await persistNormalizedExamResults(supabase, normalized);
  const enrolmentStatusUpdates = await syncEnrolmentStatusesForExamResults(supabase, data, acceptedResults);

  return NextResponse.json({
    ...summarizeExamIngestion(normalized),
    assessmentSummary,
    enrolmentStatusUpdates
  });
}
