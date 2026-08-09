"use server";

import { z } from "zod";
import {
  applicationSupportNeedsViewedAction,
  buildApplicationSupportNeedsViewedAuditMetadata
} from "@/lib/application-review";
import { requirePermission } from "@/lib/auth";
import { createSupabaseServerClient, isSupabaseConfigured } from "@/lib/supabase";

export interface RevealApplicationSupportNeedsState {
  status: "idle" | "revealed" | "unavailable";
  supportDetail?: string;
  requestedAdjustments?: string;
  message?: string;
}

const supportNeedsReferenceSchema = z.object({
  admission_id: z.string().uuid(),
  application_id: z.string().uuid()
});

export async function revealApplicationSupportNeeds(
  _previousState: RevealApplicationSupportNeedsState,
  formData: FormData
): Promise<RevealApplicationSupportNeedsState> {
  const staff = await requirePermission("manage_admissions");
  const parsed = supportNeedsReferenceSchema.parse({
    admission_id: String(formData.get("admission_id") ?? ""),
    application_id: String(formData.get("application_id") ?? "")
  });

  if (!isSupabaseConfigured()) {
    return {
      status: "revealed",
      supportDetail: "Applicant disclosed a disability-related support need.",
      requestedAdjustments: "May need scheduling notice for practical sessions."
    };
  }

  const supabase = await createSupabaseServerClient();
  const applicationResult = await supabase
    .from("applications")
    .select("id, admission_lead_id, person_id")
    .eq("id", parsed.application_id)
    .eq("admission_lead_id", parsed.admission_id)
    .maybeSingle();
  if (applicationResult.error) throw new Error(applicationResult.error.message);
  if (!applicationResult.data) {
    return { status: "unavailable", message: "The application record could not be verified." };
  }

  const supportResult = await supabase
    .from("application_support_needs")
    .select("disclosed, support_detail, requested_adjustments")
    .eq("application_id", parsed.application_id)
    .maybeSingle();
  if (supportResult.error) throw new Error(supportResult.error.message);
  if (!supportResult.data) {
    return { status: "unavailable", message: "No restricted support information is recorded." };
  }

  const { error: auditError } = await supabase.from("audit_events").insert({
    actor_type: "staff",
    actor_user_id: staff.id,
    actor_person_id: null,
    action: applicationSupportNeedsViewedAction,
    entity_type: "application_support_needs",
    entity_id: parsed.application_id,
    reason: null,
    metadata: buildApplicationSupportNeedsViewedAuditMetadata({
      applicationId: parsed.application_id,
      admissionLeadId: parsed.admission_id,
      personId: String(applicationResult.data.person_id),
      disclosed: Boolean(supportResult.data.disclosed),
      supportDetail: supportResult.data.support_detail,
      requestedAdjustments: supportResult.data.requested_adjustments
    })
  });
  if (auditError) throw new Error(`Failed to audit restricted-information access: ${auditError.message}`);

  return {
    status: "revealed",
    supportDetail: supportResult.data.support_detail ?? undefined,
    requestedAdjustments: supportResult.data.requested_adjustments ?? undefined
  };
}
