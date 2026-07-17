import { NextRequest, NextResponse } from "next/server";
import { getLmsData } from "@/lib/lms-data";
import {
  normalizeInboundExamResult,
  parseExamAdapterPayload,
  persistNormalizedExamResults,
  summarizeExamIngestion
} from "@/lib/exam-adapters";
import { createSupabaseServerClient } from "@/lib/supabase";

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
  const data = await getLmsData();
  const normalized = parsed.map((result) => normalizeInboundExamResult(result, data));
  const supabase = await createSupabaseServerClient();
  await persistNormalizedExamResults(supabase, normalized);

  return NextResponse.json(summarizeExamIngestion(normalized));
}
