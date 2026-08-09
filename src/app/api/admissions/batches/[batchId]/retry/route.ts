import { after, NextResponse } from "next/server";
import { z } from "zod";
import { processAdmissionsOperationalBatch } from "@/lib/admissions-batch-worker";
import { requirePermission } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase";

export const maxDuration = 300;

export async function POST(request: Request, context: RouteContext<"/api/admissions/batches/[batchId]/retry">) {
  await requirePermission("manage_admissions");
  const batchId = z.string().uuid().safeParse((await context.params).batchId);
  const body = z.object({ request_key: z.string().uuid() }).safeParse(await request.json());
  if (!batchId.success || !body.success) return NextResponse.json({ error: "Invalid retry request." }, { status: 400 });

  const supabase = await createSupabaseServerClient();
  const result = await supabase.rpc("retry_failed_reviewed_admissions_operational_batch", {
    p_batch_id: batchId.data,
    p_request_key: body.data.request_key
  });
  if (result.error) return NextResponse.json({ error: result.error.message }, { status: 400 });
  if (typeof result.data !== "string") return NextResponse.json({ error: "The retry batch response was invalid." }, { status: 500 });

  const origin = process.env.NEXT_PUBLIC_APP_URL ?? new URL(request.url).origin;
  after(() => processAdmissionsOperationalBatch(result.data, origin));
  return NextResponse.json({ batchId: result.data }, { status: 202 });
}
