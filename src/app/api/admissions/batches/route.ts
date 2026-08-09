import { after, NextResponse } from "next/server";
import { ZodError } from "zod";
import { admissionsBatchReviewRequestSchema } from "@/lib/admissions-batch-review";
import { resolveAdmissionsBatchPreview, reviewedFiltersFromBatchRequest } from "@/lib/admissions-batch-review-data";
import { processAdmissionsOperationalBatch } from "@/lib/admissions-batch-worker";
import { requirePermission } from "@/lib/auth";
import { createSupabaseServerClient, isSupabaseConfigured } from "@/lib/supabase";

export const maxDuration = 300;

export async function POST(request: Request) {
  await requirePermission("manage_admissions");
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "Operational batches require a configured database." }, { status: 503 });
  }

  try {
    const input = admissionsBatchReviewRequestSchema.parse(await request.json());
    if (!input.request_key) {
      return NextResponse.json({ error: "A stable request key is required." }, { status: 400 });
    }
    const preview = await resolveAdmissionsBatchPreview(input);
    if (preview.reviewedCount === 0) {
      return NextResponse.json({ error: "No admissions records match the reviewed scope." }, { status: 400 });
    }

    const supabase = await createSupabaseServerClient();
    const result = input.action === "invite_application"
      ? await supabase.rpc("create_new_student_invitation_operational_batch", {
          p_request_key: input.request_key,
          p_scope: input.scope,
          p_targets: preview.targets,
          p_reviewed_filters: reviewedFiltersFromBatchRequest(input),
          p_rendered_subject: input.rendered_subject,
          p_rendered_body: input.rendered_body
        })
      : await supabase.rpc("create_reasoned_admissions_operational_batch", {
          p_request_key: input.request_key,
          p_workspace: input.workspace,
          p_action: input.action,
          p_scope: input.scope,
          p_targets: preview.targets,
          p_reviewed_filters: reviewedFiltersFromBatchRequest(input),
          p_reason: input.action_reason
        });
    if (result.error) throw new Error(result.error.message);
    if (typeof result.data !== "string") throw new Error("The operational batch response was invalid.");

    const batchId = result.data;
    const origin = process.env.NEXT_PUBLIC_APP_URL ?? new URL(request.url).origin;
    after(() => processAdmissionsOperationalBatch(batchId, origin));
    return NextResponse.json({ batchId }, { status: 202 });
  } catch (error) {
    const message = error instanceof ZodError
      ? error.issues[0]?.message ?? "The operational batch request is invalid."
      : error instanceof Error ? error.message : "The operational batch could not be queued.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
