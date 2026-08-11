import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { resolveAdmissionsBatchPreview } from "@/lib/admissions-batch-review-data";
import { requirePermission } from "@/lib/auth";

export async function POST(request: Request) {
  await requirePermission("manage_admissions");
  try {
    const preview = await resolveAdmissionsBatchPreview(await request.json());
    return NextResponse.json(preview);
  } catch (error) {
    const message = error instanceof ZodError
      ? error.issues[0]?.message ?? "The batch review request is invalid."
      : error instanceof Error ? error.message : "The batch review could not be prepared.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
