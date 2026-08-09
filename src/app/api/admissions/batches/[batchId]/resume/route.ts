import { after, NextResponse } from "next/server";
import { z } from "zod";
import { processAdmissionsOperationalBatch } from "@/lib/admissions-batch-worker";
import { requirePermission } from "@/lib/auth";

export const maxDuration = 300;

export async function POST(request: Request, context: RouteContext<"/api/admissions/batches/[batchId]/resume">) {
  await requirePermission("manage_admissions");
  const parsed = z.string().uuid().safeParse((await context.params).batchId);
  if (!parsed.success) return NextResponse.json({ error: "Invalid batch reference." }, { status: 400 });
  const origin = process.env.NEXT_PUBLIC_APP_URL ?? new URL(request.url).origin;
  after(() => processAdmissionsOperationalBatch(parsed.data, origin));
  return NextResponse.json({ accepted: true }, { status: 202 });
}
